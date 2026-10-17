// POST /api/missions/[id]/desktop: the desktop delegation for the mission's Pine Computer.
import { delegateDesktop, errorResponse, jsonNoStore } from "@/lib/pine-desktop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonNoStore(await delegateDesktop(id));
  } catch (err) {
    return errorResponse("desktop", id, err);
  }
}
