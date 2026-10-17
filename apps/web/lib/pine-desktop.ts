// Server-side desktop access for one mission's Pine Computer (plan 4.5 and 5).
// Only the desktop token goes to the browser. The Pine project key, the Computer token
// and the session token stay on the server and never appear in a response or a log.

import {
  ApiError,
  Binding,
  CapacityExceededError,
  Client,
  CreateRateLimitedError,
  Credentials,
  LifecycleError,
  PortalError,
  ProblemType,
  type Computer,
  type Session,
} from "@pinesandbox/computer";
import { loadHandle, type PineHandle } from "@pinepoint/core";

/** The delegation envelope that `connectionFromDelegation` in @pinesandbox/computer-web reads. */
export type DesktopDelegation = ReturnType<
  Awaited<ReturnType<Computer["delegateDesktop"]>>["toJSON"]
>;

export interface DesktopTokenResponse {
  token: string;
  expiresAt: string;
}

export type ControlAction = "take" | "release";

export interface ControlResponse {
  controller: string;
  epoch: number;
  sessionName: string;
}

/** A failure with a status code and a short message that is safe to send to the browser. */
export class DesktopRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "DesktopRouteError";
  }
}

interface MissionComputer {
  handle: PineHandle;
  computer: Computer;
}

let client: Client | undefined;

function pineClient(): Client {
  client ??= Client.fromEnv();
  return client;
}

/** Loads the stored handle and rebuilds the Computer. Makes no request to Pine. */
async function missionComputer(missionId: string): Promise<MissionComputer> {
  const handle = await loadHandle(missionId);
  if (!handle) {
    throw new DesktopRouteError(
      404,
      "handle_not_found",
      "This mission has no Pine Computer.",
    );
  }
  const computer = pineClient().reconnectComputer(
    Credentials.parse(handle.credentials),
    Binding.parse(handle.binding),
  );
  return { handle, computer };
}

function missionSession({ handle, computer }: MissionComputer): Session {
  return computer.adoptSession(handle.sessionName, handle.sessionToken);
}

/**
 * Resumes the Computer when it is paused. Pause is not enabled for the Pine project
 * (VI-7 spike), so a failed status read or resume is logged and the call continues.
 */
async function resumeIfPaused(missionId: string, computer: Computer): Promise<void> {
  try {
    const state = await computer.status();
    if (state === "paused" || state === "pausing" || state === "resuming") {
      await computer.resume();
    }
  } catch (err) {
    logPineError("resume", missionId, err);
  }
}

/**
 * Rebuilds the Computer and session, resumes the Computer if it is paused, then
 * returns the desktop delegation for the browser. It does not create a session.
 */
export async function delegateDesktop(missionId: string): Promise<DesktopDelegation> {
  const mc = await missionComputer(missionId);
  await resumeIfPaused(missionId, mc.computer);
  const connection = await mc.computer.delegateDesktop(mc.handle.sessionName, {
    create: false,
  });
  return connection.toJSON();
}

/** Mints a fresh desktop token for the mission's session. The token lasts 120 seconds. */
export async function mintDesktopToken(missionId: string): Promise<DesktopTokenResponse> {
  const session = missionSession(await missionComputer(missionId));
  const { token, expiresAt } = await session.desktopToken();
  return { token, expiresAt };
}

/** Gives the session to the person ("take") or back to Pine's agent ("release"). */
export async function setControl(
  missionId: string,
  action: ControlAction,
): Promise<ControlResponse> {
  const { handle, computer } = await missionComputer(missionId);
  const state =
    action === "take"
      ? await computer.takeControl(handle.sessionName)
      : await computer.releaseControl(handle.sessionName);
  return {
    controller: state.controller,
    epoch: state.epoch,
    sessionName: state.sessionName,
  };
}

export function parseControlAction(body: unknown): ControlAction {
  const action = (body as { action?: unknown } | null)?.action;
  if (action === "take" || action === "release") {
    return action;
  }
  throw new DesktopRouteError(
    400,
    "invalid_action",
    'Set "action" to "take" or "release".',
  );
}

/**
 * Logs only safe fields of an error: its class, status, problem type, code, operation
 * and request ID. It never logs the message body, which can echo request data.
 */
function logPineError(step: string, missionId: string, err: unknown): void {
  const e = err as Partial<ApiError & LifecycleError>;
  console.error(`[pine-desktop] ${step} failed`, {
    missionId,
    error: err instanceof Error ? err.name : typeof err,
    status: e.status,
    problemType: e.problemType,
    code: e.code,
    operation: e.operation,
    requestId: e.requestId,
  });
}

const noStore = { "Cache-Control": "no-store" };

/** Returns the JSON body with no-store headers. Use it for every success response. */
export function jsonNoStore(body: unknown): Response {
  return Response.json(body, { headers: noStore });
}

/** Maps an error to a JSON response with a status code. Sends no secret to the browser. */
export function errorResponse(step: string, missionId: string, err: unknown): Response {
  const fail = (status: number, code: string, error: string, retryAfter?: number) => {
    const headers: Record<string, string> = { ...noStore };
    if (retryAfter !== undefined) {
      headers["Retry-After"] = String(retryAfter);
    }
    return Response.json(
      retryAfter === undefined ? { error, code } : { error, code, retryAfter },
      { status, headers },
    );
  };

  if (err instanceof DesktopRouteError) {
    return fail(err.status, err.code, err.message, err.retryAfter);
  }

  logPineError(step, missionId, err);

  if (err instanceof ApiError && err.is(ProblemType.sessionBusy)) {
    return fail(409, "session_busy", "The session is busy. Try again.");
  }
  if (err instanceof CreateRateLimitedError) {
    return fail(
      429,
      "create_rate_limited",
      "Pine limits how many Computers start each minute. Try again later.",
      Math.max(1, err.retryAfterSeconds),
    );
  }
  if (err instanceof CapacityExceededError) {
    return fail(
      429,
      "capacity_exceeded",
      "The Pine project is at its Computer limit. Try again later.",
    );
  }
  if (err instanceof ApiError || err instanceof LifecycleError || err instanceof PortalError) {
    return fail(502, "pine_error", `Pine refused the ${step} request.`);
  }
  return fail(502, "pine_error", `The ${step} request failed.`);
}
