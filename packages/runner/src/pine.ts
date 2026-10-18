// Thin wrapper over @pinesandbox/computer 0.3.3: one ephemeral Computer with one session for each mission.
// Every name here comes from node_modules/@pinesandbox/computer/dist/index.d.ts (VI-7 verified them).
// No function waits longer than the caller asks. The handles are rebuilt from missions.pine_enc on each call.

import {
  Binding,
  Client,
  Credentials,
  type AgentTurn,
  type Artifact,
  type Computer,
  type ProjectPolicy,
  type Session,
} from "@pinesandbox/computer";
import { put } from "@vercel/blob";
import { MissionResultSchema, type MissionResult, type PineHandle } from "@pinepoint/core";
import { buildGoal, type GoalInput } from "./goal";

/** One mission may run this long (plan section 5, rule 7). It is also the turn's own wall budget. */
export const MISSION_BUDGET_MS = 4 * 60 * 1000;

/**
 * Idle timeout for every mission Computer. Pause is not enabled on the project (VI-7), so a Computer
 * that must stay open for the session link is kept running. Work renews the idle window.
 */
export const COMPUTER_IDLE_TIMEOUT_SECONDS = 86_400;

/** The session name inside each Computer. adoptSession and delegateDesktop use it. */
export const SESSION_NAME = "mission";

/** Used when projectPolicy reports no limit. VI-7 measured 20 on this project. */
export const DEFAULT_CONCURRENCY_LIMIT = 20;

let cachedClient: Client | undefined;

/** The shared Pine client from PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. Created on first use. */
export function pineClient(): Client {
  if (!cachedClient) {
    if (!process.env.PINE_SANDBOX_API_KEY || !process.env.PINE_SANDBOX_ENDPOINT) {
      throw new Error("PINE_SANDBOX_API_KEY or PINE_SANDBOX_ENDPOINT is not set. Put both in .env.local.");
    }
    cachedClient = Client.fromEnv();
  }
  return cachedClient;
}

let cachedPolicy: { value: ProjectPolicy; at: number } | undefined;
const POLICY_TTL_MS = 60_000;

/** The project's concurrent Computer limit. Cached for one minute in this process. */
export async function concurrencyLimit(): Promise<number> {
  const now = Date.now();
  if (!cachedPolicy || now - cachedPolicy.at > POLICY_TTL_MS) {
    cachedPolicy = { value: await pineClient().projectPolicy(), at: now };
  }
  return cachedPolicy.value.maxConcurrentComputers ?? DEFAULT_CONCURRENCY_LIMIT;
}

/** Rebuilds the Computer and the session from a saved handle. No request is made. */
export function rebuild(handle: PineHandle): { computer: Computer; session: Session } {
  const computer = pineClient().reconnectComputer(
    Credentials.parse(handle.credentials),
    Binding.parse(handle.binding),
  );
  const session = computer.adoptSession(handle.sessionName, handle.sessionToken);
  return { computer, session };
}

export interface StartMissionInput extends GoalInput {
  /** The mission id. It is the idempotency key, so a repeated start returns the same turn. */
  missionId: string;
  /** apps/demo-store/qa.md at the head SHA. Written as an attachment the agent reads. */
  qaMd: string;
  /** Labels on the runtime, visible in the Pine dashboard. */
  metadata?: Record<string, string>;
}

/**
 * Creates one ephemeral Computer and one browser session, writes qa.md, and starts the goal.
 * Returns the handle to save in missions.pine_enc. Throws CapacityExceededError or
 * CreateRateLimitedError when the project refuses the create; nothing was allocated then.
 */
export async function startMission(input: StartMissionInput): Promise<PineHandle> {
  const client = pineClient();
  const computer = await client.createComputer({
    ephemeral: true,
    idleTimeoutSeconds: COMPUTER_IDLE_TIMEOUT_SECONDS,
    metadata: { app: "pinepoint", missionId: input.missionId, ...input.metadata },
  });

  try {
    const session = await computer.createSession({ name: SESSION_NAME, browser: true });
    await session.writeFile("qa.md", input.qaMd);
    const turn = await session.agent.run(buildGoal(input), {
      idempotencyKey: input.missionId,
      constraints: { maxWallMs: MISSION_BUDGET_MS },
    });
    return {
      credentials: computer.credentials().serialize(),
      binding: computer.binding().serialize(),
      sessionName: session.name,
      sessionToken: session.token,
      computerId: computer.id,
      turnId: turn.turnId,
    };
  } catch (err) {
    // The Computer exists but the mission never started. Release it so it does not hold a slot.
    await computer.stop({ timeoutMs: 30_000 }).catch(() => undefined);
    throw err;
  }
}

/** Reads the turn once more. Waits at most `timeoutMs` (default 1 second) while it still runs. */
export async function pollMission(handle: PineHandle, timeoutMs = 1000): Promise<AgentTurn> {
  if (!handle.turnId) {
    throw new Error("The handle has no turn id.");
  }
  const { session } = rebuild(handle);
  return session.agent.wait(handle.turnId, { timeoutMs });
}

/** Cancels the running turn. A waiting question is closed too. */
export async function cancelMission(handle: PineHandle): Promise<AgentTurn | undefined> {
  if (!handle.turnId) {
    return undefined;
  }
  const { session } = rebuild(handle);
  return session.agent.cancel(handle.turnId);
}

/** Releases the Computer. Resolves when compute is released or when `timeoutMs` ends; the stop goes on server-side. */
export async function stopMission(handle: PineHandle, timeoutMs = 20_000): Promise<boolean> {
  const { computer } = rebuild(handle);
  return computer.stop({ timeoutMs });
}

export interface MissionArtifacts {
  /** The parsed result.json, or null when the agent did not write one or it did not validate. */
  result: MissionResult | null;
  /** Why `result` is null, for the mission's result.reason. */
  resultError: string | null;
  /** fail.png, when the agent saved one. */
  screenshot: Uint8Array | null;
}

function pickArtifact(list: Artifact[], name: string): Artifact | undefined {
  const lower = name.toLowerCase();
  return (
    list.find((a) => a.filename === name) ??
    list.find((a) => a.relativePath.endsWith(name)) ??
    list.find((a) => a.filename.toLowerCase() === lower)
  );
}

async function readWorkdirFile(session: Session, name: string): Promise<Uint8Array | undefined> {
  try {
    const files = await session.listFiles({ pattern: name });
    const hit = files.find((f) => !f.isDir && f.name === name);
    return hit ? await session.readFile(hit.relativePath) : undefined;
  } catch {
    return undefined;
  }
}

async function readNamed(session: Session, artifacts: Artifact[], name: string): Promise<Uint8Array | undefined> {
  const artifact = pickArtifact(artifacts, name);
  if (artifact) {
    try {
      return await session.readArtifact(artifact.id);
    } catch {
      // fall through to the work directory
    }
  }
  return readWorkdirFile(session, name);
}

const decoder = new TextDecoder();

/** Parses result.json text. Exported for the tests. */
export function parseMissionResult(text: string): { result: MissionResult } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { error: `result.json is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = MissionResultSchema.safeParse(json);
  if (!parsed.success) {
    return { error: `result.json does not match the shape: ${parsed.error.message}` };
  }
  return { result: parsed.data };
}

/** Reads result.json and fail.png for the turn. Looks in the artifacts first, then in the work directory. */
export async function collectArtifacts(handle: PineHandle): Promise<MissionArtifacts> {
  const { session } = rebuild(handle);
  let artifacts: Artifact[] = [];
  try {
    artifacts = await session.listArtifacts(handle.turnId ? { turnId: handle.turnId } : {});
  } catch {
    artifacts = [];
  }

  const [resultBytes, screenshot] = await Promise.all([
    readNamed(session, artifacts, "result.json"),
    readNamed(session, artifacts, "fail.png"),
  ]);

  let result: MissionResult | null = null;
  let resultError: string | null = null;
  if (!resultBytes) {
    resultError = "The agent did not write result.json.";
  } else {
    const parsed = parseMissionResult(decoder.decode(resultBytes));
    if ("result" in parsed) {
      result = parsed.result;
    } else {
      resultError = parsed.error;
    }
  }

  return { result, resultError, screenshot: screenshot ?? null };
}

/** Uploads fail.png to Vercel Blob with public access (plan section 7). Returns the public URL. */
export async function uploadScreenshot(missionId: string, bytes: Uint8Array): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set. Put the Vercel Blob token in .env.local.");
  }
  const blob = await put(`missions/${missionId}/fail.png`, Buffer.from(bytes), {
    access: "public",
    contentType: "image/png",
    allowOverwrite: true,
  });
  return blob.url;
}

/** One picture of the screen after an agent step, stored in Vercel Blob. Saved in missions.result.steps. */
export interface StepShot {
  url: string;
  /** The step's title from Pine, for example "Click Add to cart". Empty when the frame has no step. */
  title: string;
  /** ISO time of the picture, or null. */
  at: string | null;
}

/** At most this many step pictures are kept for one mission. The last picture is always kept. */
export const MAX_STEP_SHOTS = 12;
/** Event pages read for one turn at most. Each page holds up to EVENTS_PAGE_LIMIT events. */
const MAX_EVENT_PAGES = 20;
const EVENTS_PAGE_LIMIT = 100;

function extFor(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

/** Keeps `max` items spread over the list, with the first and the last always in. Exported for the tests. */
export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(-1);
  const picked: T[] = [];
  for (let i = 0; i < max; i += 1) {
    picked.push(items[Math.round((i * (items.length - 1)) / (max - 1))]!);
  }
  return picked;
}

/**
 * Reads the turn's `frame` events (Pine's picture of the screen after each step), uploads up to
 * MAX_STEP_SHOTS of them to Vercel Blob and returns their public URLs in step order.
 * Call it before the Computer is stopped. Returns [] when the session has no frames or a read fails.
 */
export async function collectStepShots(handle: PineHandle, missionId: string): Promise<StepShot[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const { session } = rebuild(handle);
  const frames: Array<{ data: Uint8Array; mediaType: string; title: string; at: string | null }> = [];
  try {
    let after = 0;
    for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
      const res = await session.agent.eventsPage({ after, limit: EVENTS_PAGE_LIMIT, frames: true });
      for (const event of res.events) {
        if (event.type !== "frame") continue;
        if (handle.turnId && event.turnId && event.turnId !== handle.turnId) continue;
        const frame = event.frame();
        if (!frame || frame.data.byteLength === 0) continue;
        frames.push({
          data: frame.data,
          mediaType: frame.mediaType || "image/png",
          title: frame.activity?.title ?? "",
          at: (frame.observedAt ?? event.ts)?.toISOString() ?? null,
        });
      }
      if (res.nextAfter <= after || res.nextAfter >= res.latestEventId) break;
      after = res.nextAfter;
    }
  } catch (err) {
    console.warn(`[runner] could not read frames for mission ${missionId}: ${(err as Error).message}`);
  }

  const picked = sampleEvenly(frames, MAX_STEP_SHOTS);
  const uploaded = await Promise.all(
    picked.map(async (f, i) => {
      try {
        const name = `missions/${missionId}/steps/${String(i + 1).padStart(2, "0")}.${extFor(f.mediaType)}`;
        const blob = await put(name, Buffer.from(f.data), {
          access: "public",
          contentType: f.mediaType,
          allowOverwrite: true,
        });
        return { url: blob.url, title: f.title, at: f.at } satisfies StepShot;
      } catch (err) {
        console.warn(`[runner] step picture upload failed for mission ${missionId}: ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return uploaded.filter((s): s is StepShot => s !== null);
}
