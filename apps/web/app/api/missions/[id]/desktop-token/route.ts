// POST /api/missions/[id]/desktop-token: a fresh desktop token. It lasts 120 seconds.
import { errorResponse, jsonNoStore, mintDesktopToken } from "@/lib/pine-desktop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonNoStore(await mintDesktopToken(id));
  } catch (err) {
    return errorResponse("desktop-token", id, err);
  }
}
