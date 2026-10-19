// startRun and advanceRun (VI-10). Each call does a short slice of work and returns.
// The dashboard polls GET /api/runs/[id]/status every 3 seconds; that poll and lib/drive.ts in
// apps/web drive a run. The status route skips the Computer starts and calls startQueued in after().
//
// Every state change is a conditional update on the current status, so two status calls at the
// same time cannot start one mission two times or record one end state two times. The Neon HTTP
// driver sends one statement per request, which is why no code here relies on a transaction.
// A change that must not be seen half done (an end state and its follow-up missions) is one statement.
// Computer starts for one run go through a lease (start-lease.ts), so only one call starts them at a time.

import { CapacityExceededError, CreateRateLimitedError, type AgentTurn } from "@pinesandbox/computer";
import {
  loadHandle,
  saveHandle,
  sql,
  toPublicMission,
  withRunErrorColumn,
  type FindingRow,
  type MissionRow,
  type MissionStatus,
  type PineHandle,
  type PublicMissionRow,
  type RunRow,
  type RunStatus,
} from "@pinepoint/core";
import {
  PLANNING_TIMEOUT_ERROR,
  START_GRACE_MS,
  decideTurn,
  followUpsFor,
  keptToRelease,
  needsStarts,
  planningTimedOut,
  releaseDelayMs,
  runErrorText,
  runIsComplete,
  shouldKeep,
  slotsToFill,
  type FollowUp,
} from "./decide";
import {
  cancelMission,
  collectArtifacts,
  concurrencyLimit,
  isComputerGone,
  pollMission,
  startMission,
  stopMission,
  uploadScreenshot,
  collectStepShots,
} from "./pine";
import { dropStartLease, LeaseUnavailableError, takeStartLease } from "./start-lease";
import { runStartPool, type StartOutcome } from "./start-pool";

/** The gap between two Computer creates, so one run does not trip the per-minute create limit (plan risk 5). */
export const START_GAP_MS = 300;
/** Computer starts that run at the same time. One start takes about 8 s, so 6 starts take about 16 s, not 50 s. */
export const START_CONCURRENCY = 3;

/** How long one status call waits for each running turn. */
export const POLL_TIMEOUT_MS = 1000;

/** How long to wait for a Computer stop inside a status call. The stop goes on server-side after that. */
const STOP_WAIT_MS = 2000;

export interface RunSnapshot {
  run: RunRow;
  missions: PublicMissionRow[];
  findings: FindingRow[];
}

/**
 * Runs once when every mission of a run has ended, after the run moves to `reporting` and
 * before it moves to `done`. VI-12 (buildFindings) and VI-13 (postReview) register here.
 */
export type RunCompleteHook = (runId: string) => Promise<void>;
let runCompleteHook: RunCompleteHook = async () => undefined;
export function setRunCompleteHook(hook: RunCompleteHook): void {
  runCompleteHook = hook;
}

// ---------- reads ----------

export async function loadRun(runId: string): Promise<RunRow | null> {
  const rows = (await sql()`select * from runs where id = ${runId}`) as RunRow[];
  return rows[0] ?? null;
}

export async function loadMissions(runId: string): Promise<MissionRow[]> {
  return (await sql()`select * from missions where run_id = ${runId} order by started_at nulls last, id`) as MissionRow[];
}

async function loadFindings(runId: string): Promise<FindingRow[]> {
  return (await sql()`select * from findings where run_id = ${runId}`) as FindingRow[];
}

export async function snapshot(runId: string): Promise<RunSnapshot | null> {
  const loaded = await loadRun(runId);
  if (!loaded) return null;
  const [missions, findings] = await Promise.all([loadMissions(runId), loadFindings(runId)]);
  // The start lease is internal (start-lease.ts). It does not go to the client.
  const { start_lease_until: _lease, ...run } = loaded as RunRow & { start_lease_until?: unknown };
  // runs.error is missing until the first failure adds the column (core/run-error.ts). Send null then.
  return { run: { ...run, error: run.error ?? null }, missions: missions.map(toPublicMission), findings };
}

/** Computers in use across all runs: running missions plus kept ones from the last day (their idle timeout). */
async function computersInUse(): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from missions
    where status = 'running'
       or (kept and coalesce(finished_at, started_at, now()) > now() - interval '24 hours')
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

async function keptFailedInRun(runId: string): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from missions where run_id = ${runId} and kept and status = 'failed'
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ---------- starting ----------

/**
 * Moves up to `n` queued missions to running and returns them. `for update skip locked` makes two
 * concurrent claims take different rows. Follow-up runs go first: they arrive late and gate the findings.
 */
async function claimQueued(runId: string, n: number): Promise<MissionRow[]> {
  if (n <= 0) return [];
  return (await sql()`
    update missions set status = 'running', started_at = now()
    where id in (
      select id from missions
      where run_id = ${runId} and status = 'queued'
      order by (kind = 'preview'), id
      limit ${n}
      for update skip locked
    )
    returning *
  `) as MissionRow[];
}

/** Puts a claimed mission back in the queue. Only when it has no handle yet, so a started one is never requeued. */
async function requeue(missionId: string): Promise<void> {
  await sql()`
    update missions set status = 'queued', started_at = null
    where id = ${missionId} and status = 'running' and pine_enc is null
  `;
}

async function markError(missionId: string, reason: string, from: MissionStatus = "running"): Promise<void> {
  const result = JSON.stringify({ reason });
  await sql()`
    update missions set status = 'error', result = ${result}::jsonb, finished_at = now()
    where id = ${missionId} and status = ${from}
  `;
}

function isRateLimited(err: unknown): err is CreateRateLimitedError {
  return err instanceof CreateRateLimitedError || (err as { name?: string })?.name === "CreateRateLimitedError";
}
function isCapacityExceeded(err: unknown): boolean {
  return err instanceof CapacityExceededError || (err as { name?: string })?.name === "CapacityExceededError";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts the claimed missions, START_CONCURRENCY at a time with a short gap. On CreateRateLimitedError the run
 * waits `retryAfterSeconds` and the rest go back to the queue. Returns how many started.
 */
async function startClaimed(run: RunRow, claimed: MissionRow[]): Promise<number> {
  const { started, notLaunched } = await runStartPool(
    claimed,
    async (mission): Promise<StartOutcome> => {
      try {
        const handle = await startMission({
          missionId: mission.id,
          persona: mission.persona ?? "Visitor",
          lens: mission.lens ?? "Flow",
          goal: mission.goal ?? "Open the page and read it.",
          checks: mission.checks ?? [],
          url: mission.url ?? run.preview_url ?? "",
          qaMd: run.qa_md ?? "",
          metadata: { runId: run.id, kind: mission.kind },
        });
        await saveHandle(mission.id, handle);
        return "started";
      } catch (err) {
        if (isRateLimited(err)) {
          const seconds = Math.max(1, Math.ceil(err.retryAfterSeconds || 5));
          await sql()`update runs set next_start_at = now() + make_interval(secs => ${seconds}) where id = ${run.id}`;
          await requeue(mission.id);
          return "stop";
        }
        if (isCapacityExceeded(err)) {
          await requeue(mission.id);
          return "stop";
        }
        await markError(mission.id, `Could not start the Computer: ${(err as Error).message}`);
        return "failed";
      }
    },
    { concurrency: START_CONCURRENCY, gapMs: START_GAP_MS },
  );
  await Promise.all(notLaunched.map((m) => requeue(m.id)));
  return started;
}

/**
 * Fills the free Computer slots with queued missions of this run, at most MAX_STARTS_PER_CALL in
 * one call. Returns how many started. Only the call that holds the run's start lease starts
 * Computers; the others return 0. When the lease cannot be read at all (the column is missing and
 * cannot be added), the call goes on without it, as before the lease existed.
 */
async function fillSlots(run: RunRow): Promise<number> {
  if (run.next_start_at && new Date(run.next_start_at).getTime() > Date.now()) {
    return 0;
  }
  // A string: this call holds the lease until that time. null: another call holds it.
  // undefined: the lease column cannot exist on this database, so go on without a lease.
  let lease: string | null | undefined;
  try {
    lease = await takeStartLease(run.id);
  } catch (err) {
    if (!(err instanceof LeaseUnavailableError)) {
      // A passing database error: start nothing in this call. The next poll tries again.
      console.warn(`[runner] could not take the start lease of run ${run.id}: ${(err as Error).message}`);
      return 0;
    }
    console.warn(`[runner] no start lease column for run ${run.id}, starting without a lease: ${err.message}`);
    lease = undefined;
  }
  if (lease === null) return 0;
  try {
    const [limit, inUse] = await Promise.all([concurrencyLimit(), computersInUse()]);
    const n = slotsToFill(limit, inUse);
    if (n === 0) return 0;
    const claimed = await claimQueued(run.id, n);
    if (claimed.length === 0) return 0;
    return await startClaimed(run, claimed);
  } finally {
    if (lease) {
      await dropStartLease(run.id, lease).catch((err: Error) =>
        console.warn(`[runner] could not drop the start lease of run ${run.id}: ${err.message}`),
      );
    }
  }
}

/**
 * Starts the first missions of a run, up to the project limit. The background step of POST
 * /api/runs and the webhook calls it once, after addMissions. The drive loop and startQueued start the rest.
 */
export async function startRun(runId: string): Promise<number> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  if (run.status !== "running") return 0;
  return fillSlots(run);
}

/**
 * Starts queued missions of a running run in the free Computer slots. Returns how many started,
 * 0 for a missing run or a run that is not running. The status route calls it in after(), so a
 * poll never waits on Computer starts (about 8 seconds each). Safe with many callers at once:
 * only the holder of the run's start lease starts Computers, at most MAX_STARTS_PER_CALL of them,
 * and claimQueued takes each row with `for update skip locked`, so two calls never start one mission.
 */
export async function startQueued(runId: string): Promise<number> {
  const run = await loadRun(runId);
  if (!run || run.status !== "running") return 0;
  return fillSlots(run);
}

// ---------- failing ----------

/**
 * Moves the run from `from` to `failed` and writes why in runs.error. Returns true when this call
 * made the change, false when the run was not in `from` any more.
 */
export async function failRun(runId: string, error: string, from: RunStatus): Promise<boolean> {
  const rows = await withRunErrorColumn(
    () => sql()`
      update runs set status = 'failed', error = ${error}, finished_at = now()
      where id = ${runId} and status = ${from}
      returning id
    `,
  );
  return rows.length > 0;
}

// ---------- advancing ----------

/**
 * Records an end state and queues the follow-up missions (the flake and production runs of a
 * failed preview) in one statement. Returns true when this call made the change, false when
 * another call did. One statement, because no other call may see the mission ended while its
 * follow-ups do not exist yet: the run would look complete, and the findings would be built
 * without the flake verdict.
 */
async function recordEnd(
  missionId: string,
  status: MissionStatus,
  result: Record<string, unknown> | null,
  usage: unknown,
  kept: boolean,
  followUps: FollowUp[] = [],
): Promise<boolean> {
  const resultJson = result ? JSON.stringify(result) : null;
  const usageJson = usage ? JSON.stringify(usage) : null;
  const followUpsJson = JSON.stringify(followUps.map((f) => ({ kind: f.kind, url: f.url })));
  const rows = (await sql()`
    with ended as (
      update missions
      set status = ${status}, result = ${resultJson}::jsonb, usage = ${usageJson}::jsonb, kept = ${kept}, finished_at = now()
      where id = ${missionId} and status = 'running'
      returning id, run_id, lens, persona, goal, checks, target_path, target_line, new_feature
    ), queued as (
      insert into missions (run_id, kind, parent_id, lens, persona, goal, checks, target_path, target_line, new_feature, url, status)
      select e.run_id, f.kind, e.id, e.lens, e.persona, e.goal, coalesce(e.checks, '[]'::jsonb),
             e.target_path, e.target_line, e.new_feature, f.url, 'queued'
      from ended e
      cross join jsonb_to_recordset(${followUpsJson}::jsonb) as f(kind text, url text)
      where not exists (select 1 from missions c where c.parent_id = e.id and c.kind = f.kind)
      returning id
    )
    select count(*)::int as won from ended
  `) as Array<{ won: number }>;
  return (rows[0]?.won ?? 0) > 0;
}

async function release(handle: PineHandle, missionId: string): Promise<void> {
  try {
    await stopMission(handle, STOP_WAIT_MS);
  } catch (err) {
    console.warn(`[runner] stop failed for mission ${missionId}: ${(err as Error).message}`);
  }
  await sql()`update missions set kept = false where id = ${missionId}`;
}

/** Stops the parent preview Computer when its flake re-run passes: the failure was a flake. */
async function releaseParentIfFlakePassed(mission: MissionRow, status: MissionStatus): Promise<void> {
  if (mission.kind !== "flake" || status !== "passed" || !mission.parent_id) return;
  const parentHandle = await loadHandle(mission.parent_id);
  if (parentHandle) await release(parentHandle, mission.parent_id);
}

/** Advances one running mission by at most one second. */
async function advanceMission(run: RunRow, mission: MissionRow): Promise<void> {
  const startedAtMs = mission.started_at ? new Date(mission.started_at).getTime() : Date.now();
  const handle = await loadHandle(mission.id);

  if (!handle) {
    // Claimed by a request that is still inside startMission, or by one that died. Give it the grace period.
    if (Date.now() - startedAtMs > START_GRACE_MS) {
      await markError(mission.id, "The mission was claimed but its Computer never started.");
    }
    return;
  }

  let turn: AgentTurn;
  try {
    turn = await pollMission(handle, POLL_TIMEOUT_MS);
  } catch (err) {
    if (isComputerGone(err)) {
      if (await recordEnd(mission.id, "error", { reason: `The Computer is gone: ${(err as Error).message}` }, null, false)) {
        return;
      }
    } else if (Date.now() - startedAtMs > START_GRACE_MS + 4 * 60 * 1000) {
      // Repeated transport errors well past the budget: do not spin forever.
      await recordEnd(mission.id, "error", { reason: `Could not read the turn: ${(err as Error).message}` }, null, false);
    } else {
      console.warn(`[runner] poll failed for mission ${mission.id}: ${(err as Error).message}`);
    }
    return;
  }

  const ended = turn.state === "completed" || turn.state === "answered";
  const artifacts = ended ? await collectArtifacts(handle) : null;

  const decision = decideTurn({
    state: turn.state,
    terminalReason: turn.result?.terminalReason,
    summary: turn.state === "needs_input" ? turn.question : turn.result?.summary,
    result: artifacts?.result ?? null,
    resultError: artifacts?.resultError ?? null,
    startedAtMs,
    nowMs: Date.now(),
  });
  if (decision.status === null) return;

  const kept = shouldKeep(decision.status, mission.kind, await keptFailedInRun(run.id));
  // A failed preview queues its flake and production runs in the same statement as its end state.
  const followUps = decision.status === "failed" ? followUpsFor(mission, run) : [];
  const won = await recordEnd(mission.id, decision.status, decision.result, turn.result?.usage ?? null, kept, followUps);
  if (!won) return;

  if (decision.cancel) {
    await cancelMission(handle).catch((err: Error) => console.warn(`[runner] cancel failed: ${err.message}`));
  }

  let failShotUrl: string | null = null;
  if (artifacts?.screenshot && decision.status !== "passed") {
    try {
      failShotUrl = await uploadScreenshot(mission.id, artifacts.screenshot);
    } catch (err) {
      console.warn(`[runner] screenshot upload failed for mission ${mission.id}: ${(err as Error).message}`);
    }
  }
  // Pine's picture of the screen after each step. Read before the Computer stops.
  const steps = await collectStepShots(handle, mission.id).catch(() => []);
  const shotUrl = failShotUrl ?? steps.at(-1)?.url ?? null;
  if (shotUrl || steps.length > 0) {
    const stepsJson = JSON.stringify({ step_shots: steps });
    await sql()`
      update missions
      set screenshot_url = coalesce(${shotUrl}, screenshot_url),
          result = coalesce(result, '{}'::jsonb) || ${stepsJson}::jsonb
      where id = ${mission.id}
    `;
  }

  await releaseParentIfFlakePassed(mission, decision.status);

  if (!kept) {
    await release(handle, mission.id);
  }
}

/**
 * Moves the run to reporting exactly once, runs the completion hook, then marks it done. The
 * update checks the missions again, so a stale read of them cannot complete a run whose
 * follow-up missions were queued after that read.
 */
async function completeRun(runId: string): Promise<void> {
  const rows = await sql()`
    update runs set status = 'reporting'
    where id = ${runId} and status = 'running'
      and exists (select 1 from missions where run_id = ${runId})
      and not exists (select 1 from missions where run_id = ${runId} and status in ('queued', 'running'))
    returning id
  `;
  if (rows.length === 0) return;
  try {
    await runCompleteHook(runId);
    await sql()`update runs set status = 'done', finished_at = now() where id = ${runId} and status = 'reporting'`;
  } catch (err) {
    console.error(`[runner] completion hook failed for run ${runId}: ${(err as Error).message}`);
    await failRun(runId, runErrorText("Reporting failed", err), "reporting");
  }
}

/**
 * Stops the kept Computers of an ended run that no Bug finding names, and sets kept = false.
 * lib/run-hooks.ts calls it after buildFindings and postReview. Without it, computersInUse counts
 * each kept Computer for 24 hours and later runs get no free slots. A mission that ended in the last
 * RELEASE_GRACE_MS waits first, so a status call can finish reading its step pictures.
 * Returns how many it released. It logs a failure and never throws, so a release error cannot fail the run.
 */
export async function releaseUnneededKept(
  runId: string,
  findings: Array<Pick<FindingRow, "level" | "mission_ids">>,
): Promise<number> {
  let missions: MissionRow[];
  try {
    missions = keptToRelease(await loadMissions(runId), findings);
  } catch (err) {
    console.warn(`[runner] could not read the kept missions of run ${runId}: ${(err as Error).message}`);
    return 0;
  }
  const results = await Promise.allSettled(
    missions.map(async (mission) => {
      const wait = releaseDelayMs(mission.finished_at, Date.now());
      if (wait > 0) await sleep(wait);
      const handle = await loadHandle(mission.id);
      if (handle) {
        await release(handle, mission.id);
      } else {
        await sql()`update missions set kept = false where id = ${mission.id}`;
      }
    }),
  );
  let released = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      released += 1;
    } else {
      console.warn(`[runner] could not release mission ${missions[i]!.id}: ${(r.reason as Error)?.message ?? r.reason}`);
    }
  });
  return released;
}

export interface AdvanceOptions {
  /**
   * Start queued missions in free slots in this call. Default true. The status route passes false
   * and calls startQueued in after(), so the poll answers without waiting on Computer starts.
   */
  fillSlots?: boolean;
}

/**
 * One slice of progress for a run: poll every running mission for at most one second, record end
 * states with the flake and production runs of failures, start queued missions in free slots, and
 * finish the run when nothing is left. Returns the run, its missions and its findings.
 * A run in `planning` only gets the timeout check: after 6 minutes it moves to failed.
 */
export async function advanceRun(runId: string, options: AdvanceOptions = {}): Promise<RunSnapshot | null> {
  const run = await loadRun(runId);
  if (!run) return null;
  if (run.status === "planning") {
    if (planningTimedOut(run, Date.now())) {
      await failRun(runId, PLANNING_TIMEOUT_ERROR, "planning");
    }
    return snapshot(runId);
  }
  if (run.status !== "running") return snapshot(runId);

  const missions = await loadMissions(runId);
  const running = missions.filter((m) => m.status === "running");
  const results = await Promise.allSettled(running.map((m) => advanceMission(run, m)));
  for (const r of results) {
    if (r.status === "rejected") console.warn(`[runner] advanceMission failed: ${(r.reason as Error)?.message ?? r.reason}`);
  }

  let after = await loadMissions(runId);
  // Only with queued missions: fillSlots takes the start lease, which costs two writes.
  if (options.fillSlots !== false && needsStarts(run, after)) {
    await fillSlots(run);
    after = await loadMissions(runId);
  }
  if (runIsComplete(after)) {
    await completeRun(runId);
  }
  return snapshot(runId);
}
