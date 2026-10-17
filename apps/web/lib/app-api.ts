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

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // The body is not JSON. Keep the status text.
    }
    throw new Error(message);
  }
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

export async function createRun(
  prUrl: string,
  opts: ApiOptions = {},
): Promise<CreateRunResponse & { fake: boolean }> {
  const fake = (): CreateRunResponse & { fake: boolean } => {
    resetFakeClock();
    return { runId: FAKE_RUN_ID, fake: true };
  };
  if (opts.fake) return fake();
  try {
    const body = await getJson<CreateRunResponse>("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prUrl }),
    });
    return { ...body, fake: false };
  } catch (err) {
    if (err instanceof NotFound) return fake();
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
