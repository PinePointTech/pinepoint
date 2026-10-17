// GET /api/runs/[id]/status: advance the run by one short step and return its state (plan section 4.5).
// The dashboard polls this every 3 seconds. Each call waits at most 1 second on each running turn.

import { advanceRun } from "@pinepoint/runner";

export const dynamic = "force-dynamic";
/** Well above the measured time. A call that polls 20 missions ends in a few seconds. */
export const maxDuration = 60;

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
