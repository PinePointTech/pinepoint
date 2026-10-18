// startRun and advanceRun (VI-10). Each call does a short slice of work and returns.
// The dashboard polls GET /api/runs/[id]/status every 3 seconds; that poll is what drives a run.
//
// Every state change is a conditional update on the current status, so two status calls at the
// same time cannot start one mission two times or record one end state two times. The Neon HTTP
// driver sends one statement per request, which is why no code here relies on a transaction.

import { CapacityExceededError, CreateRateLimitedError, type AgentTurn } from "@pinesandbox/computer";
import {
  loadHandle,
  saveHandle,
  sql,
  toPublicMission,
  type FindingRow,
  type MissionRow,
  type MissionStatus,
  type PineHandle,
  type PublicMissionRow,
  type RunRow,
} from "@pinepoint/core";
import { START_GRACE_MS, decideTurn, followUpsFor, freeSlots, runIsComplete, shouldKeep } from "./decide";
import {
  cancelMission,
  collectArtifacts,
  concurrencyLimit,
  pollMission,
  startMission,
  stopMission,
  uploadScreenshot,
  collectStepShots,
} from "./pine";

/** The gap between two Computer creates, so one run does not trip the per-minute create limit (plan risk 5). */
export const START_GAP_MS = 300;

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
  const run = await loadRun(runId);
  if (!run) return null;
  const [missions, findings] = await Promise.all([loadMissions(runId), loadFindings(runId)]);
  return { run, missions: missions.map(toPublicMission), findings };
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
 * Starts the claimed missions one after another with a short gap. On CreateRateLimitedError the run
 * waits `retryAfterSeconds` and the rest go back to the queue. Returns how many started.
 */
async function startClaimed(run: RunRow, claimed: MissionRow[]): Promise<number> {
  let started = 0;
  for (let i = 0; i < claimed.length; i += 1) {
    const mission = claimed[i]!;
    if (i > 0) await sleep(START_GAP_MS);
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
      started += 1;
    } catch (err) {
      if (isRateLimited(err)) {
        const seconds = Math.max(1, Math.ceil(err.retryAfterSeconds || 5));
        await sql()`update runs set next_start_at = now() + make_interval(secs => ${seconds}) where id = ${run.id}`;
        await Promise.all(claimed.slice(i).map((m) => requeue(m.id)));
        break;
      }
      if (isCapacityExceeded(err)) {
        await Promise.all(claimed.slice(i).map((m) => requeue(m.id)));
        break;
      }
      await markError(mission.id, `Could not start the Computer: ${(err as Error).message}`);
    }
  }
  return started;
}

/** Fills the free Computer slots with queued missions of this run. Returns how many started. */
async function fillSlots(run: RunRow): Promise<number> {
  if (run.next_start_at && new Date(run.next_start_at).getTime() > Date.now()) {
    return 0;
  }
  const [limit, inUse] = await Promise.all([concurrencyLimit(), computersInUse()]);
  const free = freeSlots(limit, inUse);
  if (free === 0) return 0;
  const claimed = await claimQueued(run.id, free);
  if (claimed.length === 0) return 0;
  return startClaimed(run, claimed);
}

/**
 * Starts the first missions of a run, up to the project limit. POST /api/runs calls it once.
 * The status route starts the rest.
 */
export async function startRun(runId: string): Promise<number> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  if (run.status !== "running") return 0;
  return fillSlots(run);
}

// ---------- advancing ----------

/** Records an end state. Returns true when this call made the change, false when another call did. */
async function recordEnd(
  missionId: string,
  status: MissionStatus,
  result: Record<string, unknown> | null,
  usage: unknown,
  kept: boolean,
): Promise<boolean> {
  const resultJson = result ? JSON.stringify(result) : null;
  const usageJson = usage ? JSON.stringify(usage) : null;
  const rows = await sql()`
    update missions
    set status = ${status}, result = ${resultJson}::jsonb, usage = ${usageJson}::jsonb, kept = ${kept}, finished_at = now()
    where id = ${missionId} and status = 'running'
    returning id
  `;
  return rows.length > 0;
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

async function queueFollowUps(run: RunRow, mission: MissionRow): Promise<void> {
  for (const f of followUpsFor(mission, run)) {
    const checks = JSON.stringify(mission.checks ?? []);
    await sql()`
      insert into missions (run_id, kind, parent_id, lens, persona, goal, checks, target_path, target_line, new_feature, url, status)
      select ${run.id}, ${f.kind}, ${mission.id}, ${mission.lens}, ${mission.persona}, ${mission.goal}, ${checks}::jsonb,
             ${mission.target_path}, ${mission.target_line}, ${mission.new_feature}, ${f.url}, 'queued'
      where not exists (select 1 from missions where parent_id = ${mission.id} and kind = ${f.kind})
    `;
  }
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
    const name = (err as Error).name;
    const gone = name === "RuntimeGoneError" || name === "NotFoundError" || name === "TokenRejectedError";
    if (gone) {
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
  const won = await recordEnd(mission.id, decision.status, decision.result, turn.result?.usage ?? null, kept);
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
    const stepsJson = JSON.stringify({ steps });
    await sql()`
      update missions
      set screenshot_url = coalesce(${shotUrl}, screenshot_url),
          result = coalesce(result, '{}'::jsonb) || ${stepsJson}::jsonb
      where id = ${mission.id}
    `;
  }

  if (decision.status === "failed") {
    await queueFollowUps(run, mission);
  }
  await releaseParentIfFlakePassed(mission, decision.status);

  if (!kept) {
    await release(handle, mission.id);
  }
}

/** Moves the run to reporting exactly once, runs the completion hook, then marks it done. */
async function completeRun(runId: string): Promise<void> {
  const rows = await sql()`
    update runs set status = 'reporting' where id = ${runId} and status = 'running' returning id
  `;
  if (rows.length === 0) return;
  try {
    await runCompleteHook(runId);
    await sql()`update runs set status = 'done', finished_at = now() where id = ${runId} and status = 'reporting'`;
  } catch (err) {
    console.error(`[runner] completion hook failed for run ${runId}: ${(err as Error).message}`);
    await sql()`update runs set status = 'failed', finished_at = now() where id = ${runId} and status = 'reporting'`;
  }
}

/**
 * One slice of progress for a run: poll every running mission for at most one second, record end
 * states, queue flake and production runs for failures, start queued missions in free slots, and
 * finish the run when nothing is left. Returns the run, its missions and its findings.
 */
export async function advanceRun(runId: string): Promise<RunSnapshot | null> {
  const run = await loadRun(runId);
  if (!run) return null;
  if (run.status !== "running") return snapshot(runId);

  const missions = await loadMissions(runId);
  const running = missions.filter((m) => m.status === "running");
  const results = await Promise.allSettled(running.map((m) => advanceMission(run, m)));
  for (const r of results) {
    if (r.status === "rejected") console.warn(`[runner] advanceMission failed: ${(r.reason as Error)?.message ?? r.reason}`);
  }

  await fillSlots(run);

  const after = await loadMissions(runId);
  if (runIsComplete(after)) {
    await completeRun(runId);
  }
  return snapshot(runId);
}
