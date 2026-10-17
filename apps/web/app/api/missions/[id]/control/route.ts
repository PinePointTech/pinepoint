// POST /api/missions/[id]/control with { action: "take" | "release" }.
// "take" gives the session to the person. "release" gives it back to Pine's agent.
import { errorResponse, jsonNoStore, parseControlAction, setControl } from "@/lib/pine-desktop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const action = parseControlAction(await req.json().catch(() => null));
    return jsonNoStore(await setControl(id, action));
  } catch (err) {
    return errorResponse("control", id, err);
  }
}
