// POST /api/missions/[id]/desktop-token: a fresh desktop token. It lasts 120 seconds.
import { guardMission } from "@/lib/mission-guard";
import { errorResponse, jsonNoStore, mintDesktopToken } from "@/lib/pine-desktop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guarded = await guardMission(req, id);
  if (!guarded.ok) return guarded.response;
  try {
    return jsonNoStore(await mintDesktopToken(id));
  } catch (err) {
    return errorResponse("desktop-token", id, err);
  }
}
