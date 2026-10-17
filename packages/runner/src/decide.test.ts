import { test } from "node:test";
import assert from "node:assert/strict";
import { KEPT_CAP_PER_RUN, decideTurn, followUpsFor, freeSlots, runIsComplete, shouldKeep } from "./decide";
import { MISSION_BUDGET_MS } from "./pine";
import { parseMissionResult } from "./pine";
import { buildGoal } from "./goal";

const t0 = 1_000_000;
const passedResult = {
  checks: [{ name: "Total", expected: "$21.60", saw: "$21.60", passed: true }],
  steps: ["Open the store."],
  errors: [],
  notes: [],
  blocked: false,
};
const failedResult = {
  ...passedResult,
  checks: [{ name: "Total", expected: "$21.60", saw: "$19.44", passed: false }],
};

test("decideTurn: a running turn inside the budget stays running", () => {
  const d = decideTurn({ state: "running", result: null, startedAtMs: t0, nowMs: t0 + 60_000 });
  assert.equal(d.status, null);
  assert.equal(d.cancel, false);
});

test("decideTurn: a running turn past 4 minutes is blocked and canceled", () => {
  const d = decideTurn({ state: "running", result: null, startedAtMs: t0, nowMs: t0 + MISSION_BUDGET_MS + 1 });
  assert.equal(d.status, "blocked");
  assert.equal(d.cancel, true);
  assert.match(String(d.result?.reason), /4 minutes/);
});

test("decideTurn: a canceling turn past the budget is blocked but not canceled again", () => {
  const d = decideTurn({ state: "canceling", result: null, startedAtMs: t0, nowMs: t0 + MISSION_BUDGET_MS + 1 });
  assert.equal(d.status, "blocked");
  assert.equal(d.cancel, false);
});

test("decideTurn: needs_input becomes needs_you with the question", () => {
  const d = decideTurn({ state: "needs_input", summary: "Which coupon?", result: null, startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "needs_you");
  assert.equal(d.result?.question, "Which coupon?");
});

test("decideTurn: completed with every check passed is passed", () => {
  const d = decideTurn({ state: "completed", terminalReason: "completed", result: passedResult, startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "passed");
  assert.deepEqual(d.result?.checks, passedResult.checks);
  assert.equal(d.result?.terminalReason, "completed");
});

test("decideTurn: completed with one failed check is failed", () => {
  const d = decideTurn({ state: "completed", result: failedResult, startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "failed");
});

test("decideTurn: completed with blocked: true is blocked", () => {
  const d = decideTurn({ state: "completed", result: { ...passedResult, blocked: true }, startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "blocked");
});

test("decideTurn: completed with no checks is not passed", () => {
  const d = decideTurn({ state: "completed", result: { ...passedResult, checks: [] }, startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "failed");
});

test("decideTurn: completed without result.json is an error with the reason", () => {
  const d = decideTurn({ state: "completed", result: null, resultError: "no file", startedAtMs: t0, nowMs: t0 });
  assert.equal(d.status, "error");
  assert.equal(d.result?.reason, "no file");
});

test("decideTurn: a failed turn is an error, a canceled turn is blocked", () => {
  assert.equal(decideTurn({ state: "failed", terminalReason: "error", result: null, startedAtMs: t0, nowMs: t0 }).status, "error");
  assert.equal(decideTurn({ state: "canceled", result: null, startedAtMs: t0, nowMs: t0 }).status, "blocked");
});

test("freeSlots never goes below zero", () => {
  assert.equal(freeSlots(20, 7), 13);
  assert.equal(freeSlots(20, 20), 0);
  assert.equal(freeSlots(20, 25), 0);
});

test("followUpsFor: a failed preview mission gets a flake and a production run", () => {
  const list = followUpsFor({ kind: "preview", url: "https://preview.test", new_feature: false }, { production_url: "https://prod.test" });
  assert.deepEqual(list, [
    { kind: "flake", url: "https://preview.test" },
    { kind: "production", url: "https://prod.test" },
  ]);
});

test("followUpsFor: a new feature gets no production run", () => {
  const list = followUpsFor({ kind: "preview", url: "https://preview.test", new_feature: true }, { production_url: "https://prod.test" });
  assert.deepEqual(list, [{ kind: "flake", url: "https://preview.test" }]);
});

test("followUpsFor: no production URL means no production run", () => {
  const list = followUpsFor({ kind: "preview", url: "https://preview.test", new_feature: false }, { production_url: null });
  assert.deepEqual(list, [{ kind: "flake", url: "https://preview.test" }]);
});

test("followUpsFor: flake, production and rerun missions create nothing", () => {
  for (const kind of ["flake", "production", "rerun"] as const) {
    assert.deepEqual(followUpsFor({ kind, url: "https://x.test", new_feature: false }, { production_url: "https://p.test" }), []);
  }
});

test("shouldKeep: needs_you always, failed preview under the cap, nothing else", () => {
  assert.equal(shouldKeep("needs_you", "preview", 99), true);
  assert.equal(shouldKeep("failed", "preview", 0), true);
  assert.equal(shouldKeep("failed", "preview", KEPT_CAP_PER_RUN - 1), true);
  assert.equal(shouldKeep("failed", "preview", KEPT_CAP_PER_RUN), false);
  assert.equal(shouldKeep("failed", "flake", 0), false);
  assert.equal(shouldKeep("failed", "production", 0), false);
  assert.equal(shouldKeep("passed", "preview", 0), false);
  assert.equal(shouldKeep("blocked", "preview", 0), false);
  assert.equal(shouldKeep("error", "preview", 0), false);
});

test("runIsComplete: true only when no mission is queued or running", () => {
  assert.equal(runIsComplete([]), false);
  assert.equal(runIsComplete([{ status: "passed" }, { status: "running" }]), false);
  assert.equal(runIsComplete([{ status: "passed" }, { status: "queued" }]), false);
  assert.equal(runIsComplete([{ status: "passed" }, { status: "failed" }, { status: "needs_you" }, { status: "blocked" }, { status: "error" }]), true);
});

test("parseMissionResult accepts the plan section 6 shape and fills defaults", () => {
  const parsed = parseMissionResult('{"checks":[{"name":"a","expected":"b","passed":true}],"steps":["Open."]}');
  assert.ok("result" in parsed);
  if ("result" in parsed) {
    assert.equal(parsed.result.checks[0]!.saw, "");
    assert.deepEqual(parsed.result.errors, []);
    assert.equal(parsed.result.blocked, false);
  }
});

test("parseMissionResult reports bad JSON and a bad shape", () => {
  assert.match((parseMissionResult("{nope") as { error: string }).error, /not valid JSON/);
  assert.match((parseMissionResult('{"checks":"x"}') as { error: string }).error, /shape/);
});

test("buildGoal follows the plan section 6 template", () => {
  const goal = buildGoal({
    persona: "Coupon abuser",
    lens: "Abuse",
    url: "https://preview.test",
    goal: "Apply SAVE10 two times.",
    checks: [{ name: "Total", expected: "$21.60" }],
  });
  assert.match(goal, /^You are a simulated user\. Persona: Coupon abuser\. Lens: Abuse\./);
  assert.match(goal, /Open https:\/\/preview\.test\./);
  assert.match(goal, /2\. Stop after 12 actions\./);
  assert.match(goal, /1\. Total: expected "\$21\.60"/);
  assert.match(goal, /write result\.json/);
  assert.match(goal, /Name result\.json and fail\.png/);
});
