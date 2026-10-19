// Server-side desktop access for one mission's Pine Computer (plan 4.5 and 5).
// Only the desktop token goes to the browser. The Pine project key, the Computer token
// and the session token stay on the server and never appear in a response or a log.

import {
  Binding,
  Client,
  Credentials,
  type ApiError,
  type Computer,
  type LifecycleError,
  type Session,
} from "@pinesandbox/computer";
import { loadHandle, type PineHandle } from "@pinepoint/core";
import { isComputerGone } from "@pinepoint/runner/pine";
import {
  DesktopRouteError,
  computerStopped,
  desktopErrorFor,
  isStoppedState,
  stoppedOr as stoppedOrFrom,
} from "@pinepoint/runner/desktop-errors";

export { DesktopRouteError };

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

/** How long the check after a failed call waits for the Computer's state. */
const STATUS_TIMEOUT_MS = 5_000;

/**
 * After a failed call: the 410 computer_stopped error when Pine confirms that the Computer is
 * stopping, stopped or deleted, else the error itself (runner/desktop-errors.ts stoppedOr).
 */
function stoppedOr(computer: Computer, err: unknown): Promise<unknown> {
  return stoppedOrFrom(() => computer.status({ signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) }), err);
}

/**
 * Resumes the Computer when it is paused. Pause is not enabled for the Pine project
 * (VI-7 spike), so a failed status read or resume is logged and the call continues.
 * A stopped or deleted Computer throws the 410 computer_stopped error.
 */
async function resumeIfPaused(missionId: string, computer: Computer): Promise<void> {
  let state: string;
  try {
    state = await computer.status();
  } catch (err) {
    if (isComputerGone(err)) throw computerStopped();
    logPineError("status", missionId, err);
    return;
  }
  if (isStoppedState(state)) throw computerStopped();
  if (state === "paused" || state === "pausing" || state === "resuming") {
    try {
      await computer.resume();
    } catch (err) {
      logPineError("resume", missionId, err);
    }
  }
}

/**
 * Rebuilds the Computer and session, resumes the Computer if it is paused, then
 * returns the desktop delegation for the browser. It does not create a session.
 */
export async function delegateDesktop(missionId: string): Promise<DesktopDelegation> {
  const mc = await missionComputer(missionId);
  await resumeIfPaused(missionId, mc.computer);
  try {
    const connection = await mc.computer.delegateDesktop(mc.handle.sessionName, {
      create: false,
    });
    return connection.toJSON();
  } catch (err) {
    throw await stoppedOr(mc.computer, err);
  }
}

/** Mints a fresh desktop token for the mission's session. The token lasts 120 seconds. */
export async function mintDesktopToken(missionId: string): Promise<DesktopTokenResponse> {
  const mc = await missionComputer(missionId);
  try {
    const { token, expiresAt } = await missionSession(mc).desktopToken();
    return { token, expiresAt };
  } catch (err) {
    throw await stoppedOr(mc.computer, err);
  }
}

/** Gives the session to the person ("take") or back to Pine's agent ("release"). */
export async function setControl(
  missionId: string,
  action: ControlAction,
): Promise<ControlResponse> {
  const { handle, computer } = await missionComputer(missionId);
  try {
    const state =
      action === "take"
        ? await computer.takeControl(handle.sessionName)
        : await computer.releaseControl(handle.sessionName);
    return {
      controller: state.controller,
      epoch: state.epoch,
      sessionName: state.sessionName,
    };
  } catch (err) {
    throw await stoppedOr(computer, err);
  }
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

/**
 * Maps an error to a JSON response with a status code (runner/desktop-errors.ts desktopErrorFor):
 * 410 computer_stopped, 409 session_busy, 429 create_rate_limited or capacity_exceeded, 502
 * pine_error. Sends no secret to the browser.
 */
export function errorResponse(step: string, missionId: string, err: unknown): Response {
  if (!(err instanceof DesktopRouteError)) {
    logPineError(step, missionId, err);
  }
  const { status, code, error, retryAfter } = desktopErrorFor(step, err);
  const headers: Record<string, string> = { ...noStore };
  if (retryAfter !== undefined) {
    headers["Retry-After"] = String(retryAfter);
  }
  return Response.json(
    retryAfter === undefined ? { error, code } : { error, code, retryAfter },
    { status, headers },
  );
}
