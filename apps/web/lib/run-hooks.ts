// Registers the run completion hook: build the findings, post the PR review, then stop the kept
// Computers that no Bug needs, when every mission of a run has ended.
// Import this module for its side effect in every route that calls advanceRun, so the hook is
// set in whichever server bundle finishes the run:
//
//   import "@/lib/run-hooks";
//
// postReview locks on runs.review_posted_at, so two callers cannot post two reviews. An error is
// logged and swallowed: a failed post or a failed stop must not move the run to failed or keep it in reporting.
// The stops run in next/server after(), so the run moves to done without waiting for them.

import { after } from "next/server";
import { buildFindings } from "@pinepoint/ai";
import type { FindingRow } from "@pinepoint/core";
import { releaseUnneededKept, setRunCompleteHook } from "@pinepoint/runner";
import { postReview } from "@pinepoint/github/review";

/** Stops the kept Computers that no Bug needs. Logs and never throws. */
async function releaseKept(runId: string, findings: FindingRow[]): Promise<void> {
  try {
    const released = await releaseUnneededKept(runId, findings);
    if (released > 0) console.log(`[runner] stopped ${released} kept Computer(s) of run ${runId}`);
  } catch (err) {
    console.error(`[runner] could not stop the kept Computers of run ${runId}: ${(err as Error).message}`);
  }
}

setRunCompleteHook(async (runId) => {
  // VI-12 first: the review reads the findings rows.
  let findings: FindingRow[] | null = null;
  try {
    findings = (await buildFindings(runId)).findings;
  } catch (err) {
    console.error(`[findings] could not build the findings for run ${runId}: ${(err as Error).message}`);
  }
  try {
    const result = await postReview(runId);
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
    try {
      after(() => releaseKept(runId, found));
    } catch {
      // Not inside a request (a script): run it without waiting.
      void releaseKept(runId, found);
    }
  }
});

export {};
