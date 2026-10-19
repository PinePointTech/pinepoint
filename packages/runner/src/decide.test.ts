import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEPT_CAP_PER_RUN,
  MAX_RUN_ERROR_CHARS,
  MAX_STARTS_PER_CALL,
  PLANNING_TIMEOUT_ERROR,
  PLANNING_TIMEOUT_MS,
  RELEASE_GRACE_MS,
  decideTurn,
  followUpsFor,
  freeSlots,
  keptToRelease,
  needsStarts,
  planningTimedOut,
  releaseDelayMs,
  runErrorText,
  runIsComplete,
  shouldKeep,
  slotsToFill,
} from "./decide";
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

test("planningTimedOut: a planning run older than 6 minutes timed out", () => {
  const startedAt = new Date(t0).toISOString();
  assert.equal(planningTimedOut({ status: "planning", started_at: startedAt }, t0 + PLANNING_TIMEOUT_MS + 1), true);
  assert.equal(planningTimedOut({ status: "planning", started_at: startedAt }, t0 + PLANNING_TIMEOUT_MS), false);
  assert.equal(planningTimedOut({ status: "planning", started_at: startedAt }, t0 + 60_000), false);
  assert.match(PLANNING_TIMEOUT_ERROR, /6 minutes/);
});

test("planningTimedOut: only a planning run with a start time can time out", () => {
  const late = t0 + PLANNING_TIMEOUT_MS * 10;
  const startedAt = new Date(t0).toISOString();
  for (const status of ["running", "reporting", "done", "failed", "no_preview"] as const) {
    assert.equal(planningTimedOut({ status, started_at: startedAt }, late), false, status);
  }
  assert.equal(planningTimedOut({ status: "planning", started_at: null }, late), false);
});

test("runErrorText: prefix and message, cut at the limit", () => {
  assert.equal(runErrorText("Planning failed", new Error("The planner reply did not validate.")), "Planning failed: The planner reply did not validate.");
  assert.equal(runErrorText("Planning failed", "timeout"), "Planning failed: timeout");
  assert.equal(runErrorText("Planning failed", new Error("  ")), "Planning failed: no message");
  const long = runErrorText("Planning failed", new Error("x".repeat(2000)));
  assert.equal(long.length, MAX_RUN_ERROR_CHARS);
  assert.ok(long.startsWith("Planning failed: xxx"));
  assert.ok(long.endsWith("..."));
});

test("keptToRelease: releases kept missions that no Bug finding names, and keeps needs_you", () => {
  const missions = [
    { id: "bug-preview", kept: true, status: "failed" as const },
    { id: "possible-preview", kept: true, status: "failed" as const },
    { id: "old-bug-preview", kept: true, status: "failed" as const },
    { id: "needs-you", kept: true, status: "needs_you" as const },
    { id: "stopped", kept: false, status: "failed" as const },
  ];
  const findings = [
    { level: "bug" as const, mission_ids: ["bug-preview", "stopped"] },
    { level: "possible" as const, mission_ids: ["possible-preview", "needs-you"] },
    { level: "old_bug" as const, mission_ids: ["old-bug-preview"] },
    { level: null, mission_ids: null },
  ];
  assert.deepEqual(
    keptToRelease(missions, findings).map((m) => m.id),
    ["possible-preview", "old-bug-preview"],
    "a needs_you Computer stays for Take control, also when no Bug names it",
  );
});

test("keptToRelease: releases every kept failed mission when there is no Bug, and nothing when none is kept", () => {
  assert.deepEqual(
    keptToRelease(
      [
        { id: "a", kept: true, status: "failed" },
        { id: "b", kept: true, status: "failed" },
        { id: "c", kept: true, status: "needs_you" },
      ],
      [],
    ).map((m) => m.id),
    ["a", "b"],
  );
  assert.deepEqual(keptToRelease([{ id: "a", kept: false, status: "failed" }], [{ level: "possible", mission_ids: ["a"] }]), []);
});

test("slotsToFill: the free slots, at most the cap per call", () => {
  assert.equal(slotsToFill(20, 0), MAX_STARTS_PER_CALL);
  assert.equal(slotsToFill(20, 17), 3);
  assert.equal(slotsToFill(20, 20), 0);
  assert.equal(slotsToFill(20, 25), 0);
  assert.equal(slotsToFill(20, 0, 2), 2);
  assert.equal(slotsToFill(20, 0, -1), 0);
});

test("needsStarts: only a running run with queued missions", () => {
  assert.equal(needsStarts({ status: "running" }, [{ status: "running" }, { status: "queued" }]), true);
  assert.equal(needsStarts({ status: "running" }, [{ status: "running" }, { status: "passed" }]), false);
  assert.equal(needsStarts({ status: "running" }, []), false);
  assert.equal(needsStarts({ status: "planning" }, [{ status: "queued" }]), false);
  assert.equal(needsStarts({ status: "reporting" }, [{ status: "queued" }]), false);
  assert.equal(needsStarts({ status: "done" }, [{ status: "queued" }]), false);
});

test("releaseDelayMs: waits out the rest of the grace period after the mission ended", () => {
  const endedAt = new Date(t0).toISOString();
  assert.equal(releaseDelayMs(endedAt, t0), RELEASE_GRACE_MS);
  assert.equal(releaseDelayMs(endedAt, t0 + 5_000), RELEASE_GRACE_MS - 5_000);
  assert.equal(releaseDelayMs(endedAt, t0 + RELEASE_GRACE_MS), 0);
  assert.equal(releaseDelayMs(endedAt, t0 + 60 * 60_000), 0);
});

test("releaseDelayMs: no wait without an end time, never more than the grace period", () => {
  assert.equal(releaseDelayMs(null, t0), 0);
  assert.equal(releaseDelayMs("not a date", t0), 0);
  assert.equal(releaseDelayMs(new Date(t0 + 60_000).toISOString(), t0), RELEASE_GRACE_MS, "a clock skew does not wait longer");
});
