import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  CapacityExceededError,
  CreateRateLimitedError,
  LifecycleError,
  NotFoundError,
  PortalError,
  RuntimeFailedError,
  RuntimeGoneError,
  ServerError,
  TokenRejectedError,
} from "@pinesandbox/computer";
import { COMPUTER_STOPPED, DesktopRouteError, STOPPED_STATES, desktopErrorFor, isStoppedState, stoppedOr } from "./desktop-errors";

function apiError(status: number, problemType: string): ApiError {
  return new ApiError({
    status,
    problemType,
    title: "Problem",
    detail: "detail",
    reason: "",
    host: "computer.example",
    operation: "POST /v1/sessions/mission/desktop-token",
    requestId: "req-1",
    retryable: false,
    retryAfterSeconds: 0,
    currentBindingRevision: undefined,
    currentRuntimeId: "",
  });
}

function lifecycle<T extends LifecycleError>(
  Cls: new (detail: string, fields: LifecycleError) => T,
  status: number,
  retryAfterSeconds = 0,
): T {
  return new Cls("detail", {
    status,
    code: "",
    body: "",
    host: "api.example",
    operation: "GET /v1/computers/c1",
    requestId: "req-2",
    retryAfterSeconds,
  } as LifecycleError);
}

const stopped = { status: 410, code: "computer_stopped", error: "The Computer for this mission is stopped." };

test("desktopErrorFor: a gone Computer is 410 computer_stopped", () => {
  assert.deepEqual(COMPUTER_STOPPED, stopped);
  for (const err of [
    new RuntimeGoneError(apiError(404, "/errors/sandbox-not-found")),
    new TokenRejectedError(apiError(401, "")),
    lifecycle(NotFoundError, 404),
    lifecycle(LifecycleError, 404),
    new RuntimeFailedError("rt-1", "terminated"),
    Object.assign(new Error("gone"), { name: "RuntimeGoneError" }),
  ]) {
    assert.deepEqual(desktopErrorFor("desktop", err), stopped, err.name);
  }
});

test("desktopErrorFor: 410 goes before 409 and 429", () => {
  // A gone error whose problem type also reads as a busy session is still a stopped Computer.
  assert.deepEqual(desktopErrorFor("desktop", new RuntimeGoneError(apiError(409, "/errors/session-busy"))), stopped);
  const gone429 = Object.assign(lifecycle(CreateRateLimitedError, 429, 5), { name: "NotFoundError" });
  assert.deepEqual(desktopErrorFor("desktop", gone429), stopped);
});

test("desktopErrorFor: busy session 409, create limits 429 with retryAfter, other Pine errors 502", () => {
  assert.deepEqual(desktopErrorFor("desktop-token", apiError(409, "/errors/session-busy")), {
    status: 409,
    code: "session_busy",
    error: "The session is busy. Try again.",
  });
  assert.deepEqual(desktopErrorFor("desktop", lifecycle(CreateRateLimitedError, 429, 12)), {
    status: 429,
    code: "create_rate_limited",
    error: "Pine limits how many Computers start each minute. Try again later.",
    retryAfter: 12,
  });
  assert.equal(desktopErrorFor("desktop", lifecycle(CreateRateLimitedError, 429, 0)).retryAfter, 1, "at least 1 second");
  assert.deepEqual(desktopErrorFor("desktop", lifecycle(CapacityExceededError, 429)), {
    status: 429,
    code: "capacity_exceeded",
    error: "The Pine project is at its Computer limit. Try again later.",
  });
  for (const err of [apiError(500, "/errors/internal"), lifecycle(ServerError, 503), new PortalError("detail", { status: 502 })]) {
    assert.deepEqual(desktopErrorFor("desktop", err), { status: 502, code: "pine_error", error: "Pine refused the desktop request." });
  }
  assert.deepEqual(desktopErrorFor("control", new RuntimeFailedError("rt-1", "unavailable")), {
    status: 502,
    code: "pine_error",
    error: "The control request failed.",
  });
  assert.deepEqual(desktopErrorFor("control", new Error("socket hang up")), {
    status: 502,
    code: "pine_error",
    error: "The control request failed.",
  });
});

test("desktopErrorFor: a DesktopRouteError goes as it is", () => {
  assert.deepEqual(desktopErrorFor("desktop", new DesktopRouteError(404, "handle_not_found", "This mission has no Pine Computer.")), {
    status: 404,
    code: "handle_not_found",
    error: "This mission has no Pine Computer.",
  });
  assert.deepEqual(desktopErrorFor("desktop", new DesktopRouteError(429, "x", "Wait.", 7)), {
    status: 429,
    code: "x",
    error: "Wait.",
    retryAfter: 7,
  });
});

test("isStoppedState: stopping, terminated and failed", () => {
  assert.deepEqual([...STOPPED_STATES].sort(), ["failed", "stopping", "terminated"]);
  for (const state of ["running", "paused", "pausing", "resuming", "starting", ""]) {
    assert.equal(isStoppedState(state), false, state);
  }
});

test("stoppedOr: a stopping or stopped Computer gives 410, any other state the original error", async () => {
  const original = apiError(502, "/errors/bad-gateway");
  for (const state of ["stopping", "terminated", "failed"]) {
    const result = await stoppedOr(async () => state, original);
    assert.ok(result instanceof DesktopRouteError, state);
    assert.deepEqual(desktopErrorFor("desktop", result), stopped);
  }
  assert.equal(await stoppedOr(async () => "running", original), original);
  assert.equal(await stoppedOr(async () => "paused", original), original);
});

test("stoppedOr: a status read that says the Computer is gone gives 410, any other failure the original error", async () => {
  const original = new Error("socket hang up");
  const gone = await stoppedOr(async () => {
    throw lifecycle(NotFoundError, 404);
  }, original);
  assert.deepEqual(desktopErrorFor("desktop", gone), stopped);
  const unknown = await stoppedOr(async () => {
    throw new Error("timeout");
  }, original);
  assert.equal(unknown, original);
});

test("stoppedOr: does not read the state for an error that already decides", async () => {
  let reads = 0;
  const status = async () => {
    reads += 1;
    return "terminated";
  };
  const routeError = new DesktopRouteError(404, "handle_not_found", "No handle.");
  assert.equal(await stoppedOr(status, routeError), routeError);
  const goneError = new RuntimeGoneError(apiError(404, "/errors/sandbox-not-found"));
  assert.equal(await stoppedOr(status, goneError), goneError);
  assert.equal(reads, 0);
});
