// TEMPORARY: preview-only probe of one mission's Pine session (events, frames, screenshot, artifacts).
// Answers 404 outside Vercel preview deployments. Remove before merging to main.

import { loadHandle, saveShot } from "@pinepoint/core";
import { rebuild } from "@pinepoint/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errInfo(err: unknown) {
  const e = err as { name?: string; message?: string; status?: number; code?: string };
  return { name: e?.name, message: e?.message?.slice(0, 400), status: e?.status, code: e?.code };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VERCEL_ENV !== "preview") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") ?? "0");
  const handle = await loadHandle(id);
  if (!handle) return Response.json({ error: "no handle for this mission" }, { status: 404 });
  const { session, computer } = rebuild(handle);
  const out: Record<string, unknown> = { turnId: handle.turnId, computerId: handle.computerId };

  const t0 = Date.now();
  try {
    const page = await session.agent.eventsPage({ after, limit: 100, frames: true });
    const types: Record<string, number> = {};
    const turnIds = new Set<string>();
    let frames = 0;
    let frameBytes = 0;
    const frameList: Array<{ bytes: number; title: string | null; type: string }> = [];
    for (const e of page.events) {
      types[e.type] = (types[e.type] ?? 0) + 1;
      if (e.turnId) turnIds.add(e.turnId);
      const f = e.frame();
      if (f) {
        frames += 1;
        frameBytes += f.data.byteLength;
        frameList.push({ bytes: f.data.byteLength, title: f.activity?.title ?? null, type: f.mediaType });
      }
    }
    const firstFrameEvent = page.events.find((e) => e.type === "frame");
    const ff = firstFrameEvent?.frame();
    if (ff) {
      out.firstFrame = { mediaType: ff.mediaType, width: ff.width, height: ff.height, bytes: ff.data.byteLength, title: ff.activity?.title ?? null };
      if (url.searchParams.get("blob") === "1") {
        try {
          out.saved = { url: await saveShot({ missionId: id, idx: 99, mediaType: ff.mediaType, data: ff.data, title: "debug probe" }) };
        } catch (err) {
          out.blobError = errInfo(err);
        }
      }
    }
    out.page = {
      ms: Date.now() - t0,
      events: page.events.length,
      nextAfter: page.nextAfter,
      latestEventId: page.latestEventId,
      types,
      turnIds: [...turnIds],
      parsedFrames: frames,
      frameList,
      frameBytes,
      rawKeys: Object.keys(page.raw ?? {}),
      firstFramePayloadKeys: firstFrameEvent ? Object.keys(firstFrameEvent.payload ?? {}) : null,
      sampleTypes: page.events.slice(0, 5).map((e) => ({ id: e.eventId, type: e.type, keys: Object.keys(e.payload ?? {}) })),
    };
  } catch (err) {
    out.pageError = errInfo(err);
  }

  try {
    const page = await session.agent.eventsPage({ after, limit: 100, frames: false });
    out.pageNoFrames = { events: page.events.length, nextAfter: page.nextAfter, latestEventId: page.latestEventId };
  } catch (err) {
    out.pageNoFramesError = errInfo(err);
  }

  try {
    const status = await session.agent.status();
    out.status = JSON.parse(JSON.stringify(status, (_k, v) => (typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}...` : v)));
  } catch (err) {
    out.statusError = errInfo(err);
  }

  if (url.searchParams.get("shot") === "1") {
    const t1 = Date.now();
    try {
      const shot = await session.drive.screenshot({ signal: AbortSignal.timeout(20_000) });
      out.shot = { ms: Date.now() - t1, ok: shot.ok, base64Length: shot.screenshot?.length ?? 0, keys: Object.keys(shot) };
    } catch (err) {
      out.shotError = { ms: Date.now() - t1, ...errInfo(err) };
    }
    try {
      const obs = await session.drive.observe({ signal: AbortSignal.timeout(20_000) });
      out.observe = { keys: Object.keys(obs), screenshotLength: (obs as { screenshot?: string }).screenshot?.length ?? 0 };
    } catch (err) {
      out.observeError = errInfo(err);
    }
  }

  try {
    const arts = await session.listArtifacts(handle.turnId ? { turnId: handle.turnId } : {});
    out.artifacts = arts.map((a) => ({ filename: a.filename, path: a.relativePath, size: a.size, type: a.contentType }));
  } catch (err) {
    out.artifactsError = errInfo(err);
  }

  try {
    out.runtime = { status: await computer.status() };
  } catch (err) {
    out.runtimeError = errInfo(err);
  }

  return Response.json(out);
}
