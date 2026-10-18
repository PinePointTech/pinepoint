// GET /api/runs/[id]/status: advance the run by one short step and return its state (plan section 4.5).
// The dashboard polls this every 3 seconds. Each call waits at most 1 second on each running turn.
//
// When the last mission ends, the runner moves the run to `reporting` one time and calls the hook
// below: build the findings (VI-12), then post the PR review (VI-13). Then the run is `done`.

import { buildFindings } from "@pinepoint/ai";
import { postReview } from "@pinepoint/github/review";
import { advanceRun, setRunCompleteHook } from "@pinepoint/runner";

setRunCompleteHook(async (runId) => {
  await buildFindings(runId);
  await postReview(runId);
});

export const dynamic = "force-dynamic";
/** The completion call runs about 10 STE rewrites and posts the review. Well above the measured poll time. */
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return Response.json({ error: "The run id is not a UUID." }, { status: 400 });
  }
  const snapshot = await advanceRun(id);
  if (!snapshot) {
    return Response.json({ error: "No run with this id." }, { status: 404 });
  }
  return Response.json(snapshot);
}
