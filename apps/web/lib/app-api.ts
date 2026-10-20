// Typed client for the /app dashboard routes (VI-10).
// When fake is true, or a route returns 404, it returns fake data.
import type {
  CreateRunRequest,
  CreateRunResponse,
  MeResponse,
  PreflightResponse,
  PullsResponse,
  RepositoriesResponse,
  RepositorySettingsView,
  RunsResponse,
  StatusResponse,
  WorkspacesResponse,
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
// `state` is the server's access state (reauthorize, sso_required, not_connected, ...) when it sent one.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly runId?: string,
    readonly state?: string,
    readonly headSha?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The server's error text, else the status text, else "HTTP <status>".
async function failure(res: Response): Promise<ApiError> {
  let message = res.statusText ? `${res.status} ${res.statusText}` : `HTTP ${res.status}`;
  let runId: string | undefined;
  let state: string | undefined;
  let headSha: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; runId?: unknown; state?: unknown; headSha?: unknown };
    if (typeof body.error === "string" && body.error.trim()) message = body.error;
    if (typeof body.runId === "string") runId = body.runId;
    if (typeof body.state === "string") state = body.state;
    if (typeof body.headSha === "string") headSha = body.headSha;
  } catch {
    // The body is not JSON. Keep the status text.
  }
  return new ApiError(message, res.status, runId, state, headSha);
}

const JSON_HEADERS = { "content-type": "application/json" };

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
  request: CreateRunRequest | string,
  opts: ApiOptions & { force?: boolean } = {},
): Promise<WithFake<CreateRunResponse>> {
  const fake = async (): Promise<WithFake<CreateRunResponse>> => {
    // A short wait, so sample data shows the start card the way a real run does.
    await wait(900);
    resetFakeClock();
    return { runId: FAKE_RUN_ID, status: "planning", existing: false, fake: true };
  };
  if (opts.fake) return fake();
  const payload: CreateRunRequest = typeof request === "string" ? { prUrl: request } : request;
  try {
    const body = await getJson<Partial<CreateRunResponse>>("/api/runs", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(opts.force ? { ...payload, force: true } : payload),
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

// ---------- sign-in and connected repositories (VI-30, VI-31, VI-35) ----------
// These never return fake data: without the GitHub App the server says signInAvailable false.

export async function getMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as MeResponse;
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw await failure(res);
}

/** Where "Continue with GitHub" goes. `returnTo` is the current /app URL. */
export function signInHref(returnTo: string): string {
  return `/api/auth/github/start?return_to=${encodeURIComponent(returnTo)}`;
}

/** Where "Connect an organization" goes. */
export function installHref(returnTo: string): string {
  return `/api/github/install?return_to=${encodeURIComponent(returnTo)}`;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export function listWorkspaces(): Promise<WorkspacesResponse> {
  return readJson<WorkspacesResponse>("/api/workspaces");
}

export function listRepositories(workspaceId: string): Promise<RepositoriesResponse> {
  return readJson<RepositoriesResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/repositories`);
}

export function listPulls(repositoryId: string): Promise<PullsResponse> {
  return readJson<PullsResponse>(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls`);
}

export function preflight(repositoryId: string, prNumber: number): Promise<PreflightResponse> {
  return readJson<PreflightResponse>(`/api/repositories/${encodeURIComponent(repositoryId)}/preflight`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ prNumber }),
  });
}

export async function getRepositorySettings(repositoryId: string): Promise<RepositorySettingsView> {
  const body = await readJson<{ settings: RepositorySettingsView }>(`/api/repositories/${encodeURIComponent(repositoryId)}/settings`);
  return body.settings;
}

export async function saveRepositorySettings(
  repositoryId: string,
  settings: { qaMdPath: string; previewProjectName: string | null; productionUrl: string | null },
): Promise<RepositorySettingsView> {
  const body = await readJson<{ settings: RepositorySettingsView }>(`/api/repositories/${encodeURIComponent(repositoryId)}/settings`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
  return body.settings;
}

export function formatCost(cost: number | string | null): string {
  const n = cost === null ? 0 : Number(cost);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}
