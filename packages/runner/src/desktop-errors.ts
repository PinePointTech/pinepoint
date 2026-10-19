// How the desktop routes (apps/web/lib/pine-desktop.ts) map an error to a status code and a body.
// No network, no database, so the tests cover the mapping with the real SDK error classes.
// Every message here is safe to send to the browser.

import {
  ApiError,
  CapacityExceededError,
  CreateRateLimitedError,
  LifecycleError,
  PortalError,
  ProblemType,
} from "@pinesandbox/computer";
import { isComputerGone } from "./pine";

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

/** The status code and the JSON body fields of a failed desktop route call. */
export interface DesktopError {
  status: number;
  code: string;
  error: string;
  /** Seconds, for the Retry-After header and the body. */
  retryAfter?: number;
}

/**
 * Lifecycle states of a Computer that never runs again. Pause is not enabled for the Pine project
 * (VI-7), so "stopping" always ends in "terminated". It is in the set because a Computer that the
 * run just released reports "stopping" for a while, and its calls fail in that time.
 */
export const STOPPED_STATES: ReadonlySet<string> = new Set(["stopping", "terminated", "failed"]);

export function isStoppedState(state: string): boolean {
  return STOPPED_STATES.has(state);
}

/** The answer for a stopped or deleted Computer (contract item 4). */
export const COMPUTER_STOPPED: Readonly<DesktopError> = {
  status: 410,
  code: "computer_stopped",
  error: "The Computer for this mission is stopped.",
};

export function computerStopped(): DesktopRouteError {
  return new DesktopRouteError(COMPUTER_STOPPED.status, COMPUTER_STOPPED.code, COMPUTER_STOPPED.error);
}

/**
 * After a failed call: the 410 computer_stopped error when Pine confirms that the Computer is
 * stopped or deleted, else the error itself. A stopped Computer can fail a call with a transport
 * or session error first, so the lifecycle state decides. `status` reads that state.
 */
export async function stoppedOr(status: () => Promise<string>, err: unknown): Promise<unknown> {
  if (err instanceof DesktopRouteError || isComputerGone(err)) return err;
  try {
    return isStoppedState(await status()) ? computerStopped() : err;
  } catch (statusErr) {
    return isComputerGone(statusErr) ? computerStopped() : err;
  }
}

/**
 * Maps an error to the route's answer. In this order: a DesktopRouteError as it is; a gone
 * Computer (RuntimeGoneError, NotFoundError, TokenRejectedError, a lifecycle 404, or a
 * RuntimeFailedError in a stopped state) 410; a busy session 409; a create rate limit or the
 * project limit 429; any other Pine error 502.
 */
export function desktopErrorFor(step: string, err: unknown): DesktopError {
  if (err instanceof DesktopRouteError) {
    return err.retryAfter === undefined
      ? { status: err.status, code: err.code, error: err.message }
      : { status: err.status, code: err.code, error: err.message, retryAfter: err.retryAfter };
  }
  // The Computer was stopped (the run released it, or its idle timeout ended). The browser shows that, not an error.
  if (isComputerGone(err)) return { ...COMPUTER_STOPPED };
  if (err instanceof ApiError && err.is(ProblemType.sessionBusy)) {
    return { status: 409, code: "session_busy", error: "The session is busy. Try again." };
  }
  if (err instanceof CreateRateLimitedError) {
    return {
      status: 429,
      code: "create_rate_limited",
      error: "Pine limits how many Computers start each minute. Try again later.",
      retryAfter: Math.max(1, err.retryAfterSeconds),
    };
  }
  if (err instanceof CapacityExceededError) {
    return { status: 429, code: "capacity_exceeded", error: "The Pine project is at its Computer limit. Try again later." };
  }
  if (err instanceof ApiError || err instanceof LifecycleError || err instanceof PortalError) {
    return { status: 502, code: "pine_error", error: `Pine refused the ${step} request.` };
  }
  return { status: 502, code: "pine_error", error: `The ${step} request failed.` };
}
