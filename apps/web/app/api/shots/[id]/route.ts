// GET /api/shots/[id]: one picture of a mission's screen from the mission_shots table.
//
// A picture of a legacy run is public like the old Blob URLs: the id is a random UUID, and the
// picture never changes, so it caches for a year. A picture of a private run is evidence
// (docs/github-access-contract.md section 7): it needs a session with view access to the run's
// repository, answers 404 otherwise, and is never cached by a shared cache.

import { loadShot, shotOwner } from "@pinepoint/core";
import { authorizeRun } from "@/lib/access";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const owner = await shotOwner(id);
  if (!owner) return new Response("Not found", { status: 404 });
  if (owner.isPrivate) {
    const guarded = await authorizeRun(request, owner.runId, "view");
    if (!guarded.ok) return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const shot = await loadShot(id);
  if (!shot) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(shot.data), {
    headers: {
      "content-type": shot.mediaType,
      "content-length": String(shot.data.byteLength),
      "cache-control": owner.isPrivate ? "private, no-store" : "public, max-age=31536000, immutable",
    },
  });
}
