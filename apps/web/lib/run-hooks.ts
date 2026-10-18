// Registers the run completion hook: build the findings, then post the PR review, when every mission of a run has ended.
// Import this module for its side effect in every route that calls advanceRun, so the hook is
// set in whichever server bundle finishes the run:
//
//   import "@/lib/run-hooks";
//
// postReview locks on runs.review_posted_at, so two callers cannot post two reviews. An error is
// logged and swallowed: a failed post must not move the run to failed or keep it in reporting.

import { buildFindings } from "@pinepoint/ai";
import { setRunCompleteHook } from "@pinepoint/runner";
import { postReview } from "@pinepoint/github/review";

setRunCompleteHook(async (runId) => {
  // VI-12 first: the review reads the findings rows.
  try {
    await buildFindings(runId);
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
});

export {};
