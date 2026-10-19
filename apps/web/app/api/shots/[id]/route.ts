// GET /api/shots/[id]: one picture of a mission's screen from the mission_shots table.
// Public like the old Blob URLs: the id is a random UUID. A picture never changes, so it caches for a year.

import { loadShot } from "@pinepoint/core";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const shot = await loadShot(id);
  if (!shot) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(shot.data), {
    headers: {
      "content-type": shot.mediaType,
      "content-length": String(shot.data.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
