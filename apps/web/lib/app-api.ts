// Typed client for the /app dashboard routes (VI-10).
// When fake is true, or a route returns 404, it returns fake data.
import type {
  CreateRunResponse,
  RunsResponse,
  StatusResponse,
} from "./app-types";
import {
  FAKE_RUN_ID,
  getFakeRuns,
  getFakeStatus,
  resetFakeClock,
} from "./fake-status";

export type ApiOptions = { fake?: boolean };

class NotFound extends Error {}

// A failed request. `runId` is set when POST /api/runs created the run before it failed.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly runId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The server's error text, else the status text, else "HTTP <status>".
async function failure(res: Response): Promise<ApiError> {
  let message = res.statusText ? `${res.status} ${res.statusText}` : `HTTP ${res.status}`;
  let runId: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; runId?: unknown };
    if (typeof body.error === "string" && body.error.trim()) message = body.error;
    if (typeof body.runId === "string") runId = body.runId;
  } catch {
    // The body is not JSON. Keep the status text.
  }
  return new ApiError(message, res.status, runId);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

// `fake` tells the page that the data is sample data, so it never asks
// Pine for a computer that does not exist.
export type WithFake<T> = T & { fake: boolean };

export async function listRuns(opts: ApiOptions = {}): Promise<WithFake<RunsResponse>> {
  if (opts.fake) return { ...getFakeRuns(), fake: true };
  try {
    return { ...(await getJson<RunsResponse>("/api/runs")), fake: false };
  } catch (err) {
    if (err instanceof NotFound) return { ...getFakeRuns(), fake: true };
    throw err;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/runs must answer in this time. Then the page stops waiting and the person can try again.
export const CREATE_RUN_TIMEOUT_MS = 30_000;

// POST /api/runs. The route answers in a few seconds: 202 planning for a new run, or 200
// with existing: true for a run of the same commit that is still going. Planning and the
// Computer starts go on after the answer. A failure throws ApiError; its runId is set when
// the run row exists, so the page can open the run anyway. No answer in 30 seconds throws
// ApiError with status 0.
export async function createRun(
  prUrl: string,
  opts: ApiOptions & { force?: boolean } = {},
): Promise<WithFake<CreateRunResponse>> {
  const fake = async (): Promise<WithFake<CreateRunResponse>> => {
    // A short wait, so sample data shows the start card the way a real run does.
    await wait(900);
    resetFakeClock();
    return { runId: FAKE_RUN_ID, status: "planning", existing: false, fake: true };
  };
  if (opts.fake) return fake();
  try {
    const body = await getJson<Partial<CreateRunResponse>>("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.force ? { prUrl, force: true } : { prUrl }),
      signal: AbortSignal.timeout(CREATE_RUN_TIMEOUT_MS),
    });
    if (typeof body.runId !== "string") throw new ApiError("The answer has no run id.", 200);
    return {
      runId: body.runId,
      status: body.status ?? "planning",
      existing: body.existing === true,
      fake: false,
    };
  } catch (err) {
    if (err instanceof NotFound) return fake();
    const name = (err as Error | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError("The server did not answer in 30 seconds. Try again.", 0);
    }
    // fetch rejects with a TypeError when there is no answer at all.
    if (err instanceof TypeError) throw new ApiError("PinePoint cannot reach the server. Try again.", 0);
    throw err;
  }
}

export async function getRunStatus(
  runId: string,
  opts: ApiOptions & { complete?: boolean } = {},
): Promise<WithFake<StatusResponse>> {
  const fake = () => ({ ...getFakeStatus(runId, { complete: opts.complete }), fake: true });
  if (opts.fake) return fake();
  try {
    const body = await getJson<StatusResponse>(
      `/api/runs/${encodeURIComponent(runId)}/status`,
    );
    return { ...body, fake: false };
  } catch (err) {
    if (err instanceof NotFound) return fake();
    throw err;
  }
}

export function formatCost(cost: number | string | null): string {
  const n = cost === null ? 0 : Number(cost);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}
