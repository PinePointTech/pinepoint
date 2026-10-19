import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  CapacityExceededError,
  CreateRateLimitedError,
  LifecycleError,
  NotFoundError,
  RuntimeGoneError,
  ServerError,
  TokenRejectedError,
} from "@pinesandbox/computer";
import { isComputerGone } from "./pine";

function apiError(status: number, problemType: string): ApiError {
  return new ApiError({
    status,
    problemType,
    title: "Problem",
    detail: "detail",
    reason: "",
    host: "computer.example",
    operation: "GET /v1/status",
    requestId: "req-1",
    retryable: false,
    retryAfterSeconds: 0,
    currentBindingRevision: undefined,
    currentRuntimeId: "",
  });
}

function lifecycle<T extends LifecycleError>(Cls: new (detail: string, fields: LifecycleError) => T, status: number): T {
  return new Cls("detail", {
    status,
    code: "",
    body: "",
    host: "api.example",
    operation: "GET /v1/computers/c1",
    requestId: "req-2",
    retryAfterSeconds: 0,
  } as LifecycleError);
}

test("isComputerGone: RuntimeGoneError, TokenRejectedError and NotFoundError mean the Computer is gone", () => {
  assert.equal(isComputerGone(new RuntimeGoneError(apiError(404, "/errors/sandbox-not-found"))), true);
  assert.equal(isComputerGone(new TokenRejectedError(apiError(401, ""))), true);
  assert.equal(isComputerGone(lifecycle(NotFoundError, 404)), true);
});

test("isComputerGone: any lifecycle error with status 404 means the Computer is gone", () => {
  assert.equal(isComputerGone(lifecycle(LifecycleError, 404)), true);
  assert.equal(isComputerGone(lifecycle(LifecycleError, 500)), false);
  assert.equal(isComputerGone(lifecycle(ServerError, 503)), false);
});

test("isComputerGone: matches by name for a copy of the SDK classes from another bundle", () => {
  for (const name of ["RuntimeGoneError", "NotFoundError", "TokenRejectedError"]) {
    const err = new Error("gone");
    err.name = name;
    assert.equal(isComputerGone(err), true, name);
  }
});

test("isComputerGone: rate limits, capacity, busy sessions and plain errors are not gone", () => {
  assert.equal(isComputerGone(lifecycle(CreateRateLimitedError, 429)), false);
  assert.equal(isComputerGone(lifecycle(CapacityExceededError, 429)), false);
  assert.equal(isComputerGone(apiError(409, "/errors/session-busy")), false);
  assert.equal(isComputerGone(apiError(404, "/errors/task-not-found")), false, "a Computer API 404 is not a lifecycle 404");
  assert.equal(isComputerGone(new Error("socket hang up")), false);
  assert.equal(isComputerGone(Object.assign(new Error("x"), { status: 404 })), false);
  assert.equal(isComputerGone(null), false);
  assert.equal(isComputerGone(undefined), false);
  assert.equal(isComputerGone("NotFoundError"), false);
});
