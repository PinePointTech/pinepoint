// Registers the run completion hook: build the findings, post the PR review, then stop the kept
// Computers that no Bug needs, when every mission of a run has ended.
// Import this module for its side effect in every route that calls advanceRun, so the hook is
// set in whichever server bundle finishes the run:
//
//   import "@/lib/run-hooks";
//
// postReview locks on runs.review_posted_at, so two callers cannot post two reviews. An error is
// logged and swallowed: a failed post or a failed stop must not move the run to failed or keep it in reporting.
// The stops and the picture prune run in next/server after(), so the run moves to done without waiting for them.

import { after } from "next/server";
import { buildFindings } from "@pinepoint/ai";
import { pruneShots, type FindingRow } from "@pinepoint/core";
import { loadRun, releaseUnneededKept, setRunAccessHook, setRunCompleteHook } from "@pinepoint/runner";
import { resolveRepositoryAccess } from "@pinepoint/github/access";
import { postReview } from "@pinepoint/github/review";
import { githubForRun, recordAction } from "./access";

/** Stops the kept Computers that no Bug needs. Logs and never throws. */
async function releaseKept(runId: string, findings: FindingRow[]): Promise<void> {
  try {
    const released = await releaseUnneededKept(runId, findings);
    if (released > 0) console.log(`[runner] stopped ${released} kept Computer(s) of run ${runId}`);
  } catch (err) {
    console.error(`[runner] could not stop the kept Computers of run ${runId}: ${(err as Error).message}`);
  }
}

/** Deletes old step pictures (pruneShots). Logs and never throws. */
async function pruneOldShots(): Promise<void> {
  try {
    const n = await pruneShots();
    if (n > 0) console.log(`[shots] deleted ${n} old step picture(s)`);
  } catch (err) {
    console.error(`[shots] could not prune old pictures: ${(err as Error).message}`);
  }
}

/** Runs `task` after the response when inside a request, else without waiting. */
function later(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Not inside a request (a script): run it without waiting.
    void task();
  }
}

// Before a private run's Computer starts, the initiator must still have write access to the
// repository, asked of GitHub now (docs/github-access-contract.md section 5). The runner fails
// the run on a denial and never starts the Computer. Legacy runs do not reach this hook.
setRunAccessHook(async (run) => {
  if (!run.repository_id || !run.initiated_by_user_id) return { ok: false, reason: "the run has no initiator" };
  const access = await resolveRepositoryAccess(run.initiated_by_user_id, run.repository_id, { fresh: true });
  if (access.canLaunch) return { ok: true };
  void recordAction({ action: "access_lost", runId: run.id, userId: run.initiated_by_user_id, detail: { state: access.state, level: access.level } });
  return { ok: false, reason: access.reason || `access is ${access.state}` };
});

setRunCompleteHook(async (runId) => {
  // VI-12 first: the review reads the findings rows.
  let findings: FindingRow[] | null = null;
  try {
    findings = (await buildFindings(runId)).findings;
  } catch (err) {
    console.error(`[findings] could not build the findings for run ${runId}: ${(err as Error).message}`);
  }
  try {
    // The review goes out under the initiator's token for a private run, the shared token for a
    // legacy one. An initiator who must sign in again gets no review, and the run still completes.
    const run = await loadRun(runId);
    if (!run) throw new Error("the run is gone");
    const result = await postReview(runId, { gh: await githubForRun(run) });
    if (result.posted) {
      void recordAction({ action: "review_post", runId, userId: run.initiated_by_user_id, detail: { reviewId: result.reviewId } });
    }
    if (result.posted) {
      console.log(`[review] posted review ${result.reviewId} for run ${runId}`);
    } else {
      console.log(`[review] review for run ${runId} was already posted`);
    }
  } catch (err) {
    console.error(`[review] could not post the review for run ${runId}: ${(err as Error).message}`);
  }
  // Only a Bug (for the "Open the paused session" link in its PR comment) and a needs_you mission
  // (for "Take control") keep their Computers. The others stop now instead of after the 24-hour
  // idle timeout, so later runs get free slots. Without findings it is not clear which Computers
  // a Bug needs, so all stay. The release can wait RELEASE_GRACE_MS (15 seconds) and then stops
  // each Computer, so it runs after the response: the run must not stay in reporting for it.
  if (findings) {
    const found = findings;
    later(() => releaseKept(runId, found));
  }
  // Each finished run also clears step pictures older than SHOT_RETENTION_DAYS, so they do not fill Neon.
  later(pruneOldShots);
});

export {};
