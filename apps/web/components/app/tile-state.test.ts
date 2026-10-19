import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Mission, Run, StatusResponse } from "@/lib/app-types";
import { FAKE_RUN_ID, getFakeStatus, resetFakeClock } from "@/lib/fake-status";
import { stageOf } from "./activity";
import { formatElapsed, secondsSince, secondsUntil } from "./progress";
import { checkLine, detailLine, findingFor, flakePassed, tileState, type TileState } from "./tile-state";

// GET /api/runs/05b37dc2-fb30-483a-820d-a1935400ed7a/status on production, trimmed to the
// fields that the cards use. It ran before has_computer and step pictures existed.
const prodRun = (): StatusResponse =>
  JSON.parse(readFileSync(new URL("./fixtures/prod-run-05b37dc2.json", import.meta.url), "utf8")) as StatusResponse;

function statesOf(s: StatusResponse, now = Date.now()) {
  const ctx = { run: s.run, missions: s.missions, now };
  return s.missions
    .filter((m) => m.kind === "preview")
    .map((m) => {
      const f = findingFor(m, s.findings);
      const state = tileState(m, f, ctx);
      return { m, f, state, detail: detailLine(state, m, f, s.missions) };
    });
}

function countOf(states: TileState[]): Record<string, number> {
  return states.reduce<Record<string, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {});
}

test("production run 05b37dc2: every preview gets a clear label", () => {
  const s = prodRun();
  assert.equal(s.run.status, "done");
  const rows = statesOf(s);
  assert.equal(rows.length, 10);
  for (const r of rows) {
    if (r.m.status === "passed") assert.equal(r.state, "passed");
    if (r.f?.level === "bug") assert.equal(r.state, "bug");
    if (r.f?.level === "old_bug") assert.equal(r.state, "old_bug");
  }
  assert.deepEqual(countOf(rows.map((r) => r.state)), { passed: 6, bug: 3, old_bug: 1 });
  // A bug card shows "Expected X. Saw Y." from the finding.
  for (const r of rows.filter((r) => r.state === "bug")) assert.match(r.detail ?? "", /^Expected .+ Saw .+/);
});

test("production run 05b37dc2 while reporting: a failure reads Check failed until the findings come", () => {
  const s = prodRun();
  const reporting = { ...s, run: { ...s.run, status: "reporting" as const }, findings: [] };
  const failed = statesOf(reporting).filter((r) => r.m.status === "failed");
  assert.equal(failed.length, 4);
  for (const r of failed) {
    assert.equal(r.state, "check_failed");
    assert.match(r.detail ?? "", /^Check failed: .+\. Expected .+\. Saw .+/);
  }
});

const base: Mission = {
  id: "m1",
  run_id: "r1",
  kind: "preview",
  parent_id: null,
  lens: "Flow",
  persona: "P",
  goal: "G",
  checks: null,
  target_path: null,
  target_line: null,
  new_feature: false,
  url: null,
  status: "queued",
  result: null,
  screenshot_url: null,
  usage: null,
  started_at: null,
  finished_at: null,
};
const runOf = (status: Run["status"], next: string | null = null) => ({ status, next_start_at: next });
const NOW = Date.parse("2026-10-19T10:00:00Z");
const later = (s: number) => new Date(NOW + s * 1000).toISOString();

test("live states: queued, waiting for Pine, starting computer, testing", () => {
  assert.equal(tileState({ ...base }, undefined, { run: runOf("running"), now: NOW }), "queued");
  assert.equal(tileState({ ...base }, undefined, { run: runOf("running", later(20)), now: NOW }), "waiting");
  // A next start in the past is no wait.
  assert.equal(tileState({ ...base }, undefined, { run: runOf("running", later(-5)), now: NOW }), "queued");
  assert.equal(tileState({ ...base, status: "running", has_computer: false }, undefined, { now: NOW }), "starting");
  assert.equal(tileState({ ...base, status: "running", has_computer: true }, undefined, { now: NOW }), "testing");
  // An older API sends no has_computer.
  assert.equal(tileState({ ...base, status: "running" }, undefined, { now: NOW }), "testing");
  assert.equal(tileState({ ...base, status: "needs_you" }, undefined, { now: NOW }), "needs_you");
});

test("end states: could not run, blocked, timed out", () => {
  const err = { ...base, status: "error" as const, result: { reason: "Could not start the Computer: boom" } };
  assert.equal(tileState(err), "could_not_run");
  assert.equal(detailLine("could_not_run", err, undefined), "Could not start the Computer: boom");
  const late = { ...base, status: "blocked" as const, result: { reason: "The mission ran past 4 minutes. PinePoint stopped it." } };
  assert.equal(tileState(late), "timed_out");
  assert.equal(tileState({ ...base, status: "blocked", result: { blocked: true } }), "blocked");
});

test("a finding decides the label before the mission status", () => {
  const failed = { ...base, status: "failed" as const };
  const finding = (level: "bug" | "possible" | "old_bug") => ({ id: "f", mission_ids: ["m1"], level }) as never;
  assert.equal(tileState(failed, finding("bug")), "bug");
  assert.equal(tileState(failed, finding("old_bug")), "old_bug");
  assert.equal(tileState(failed, finding("possible")), "possible");
  assert.equal(tileState({ ...base, status: "passed" }), "passed");
});

test("a failed check: re-checking, check failed, not confirmed", () => {
  const failed: Mission = {
    ...base,
    status: "failed",
    result: { checks: [{ name: "Total", expected: "$21.60", saw: "$19.44", passed: false }] },
  };
  const flake = (status: Mission["status"]): Mission => ({ ...base, id: "f1", kind: "flake", parent_id: "m1", status });
  const prod = (status: Mission["status"]): Mission => ({ ...base, id: "p1", kind: "production", parent_id: "m1", status });
  const ctx = (status: Run["status"], ...more: Mission[]) => ({ run: runOf(status), missions: [failed, ...more] });

  assert.equal(tileState(failed, undefined, ctx("running", flake("queued"))), "rechecking");
  assert.equal(tileState(failed, undefined, ctx("running", flake("running"))), "rechecking");
  assert.equal(tileState(failed, undefined, ctx("running", flake("failed"), prod("running"))), "rechecking");
  assert.equal(tileState(failed, undefined, ctx("running", flake("failed"))), "check_failed");
  assert.equal(tileState(failed, undefined, ctx("reporting", flake("failed"))), "check_failed");
  assert.equal(tileState(failed, undefined, ctx("done", flake("passed"))), "not_confirmed");
  assert.equal(tileState(failed, undefined, ctx("failed")), "not_confirmed");

  assert.equal(flakePassed(failed, [failed, flake("passed")]), true);
  assert.equal(flakePassed(failed, [failed, flake("failed"), prod("passed")]), false);
  assert.equal(
    detailLine("not_confirmed", failed, undefined, [failed, flake("passed")]),
    "The re-check passed, so PinePoint does not report it.",
  );
  assert.equal(detailLine("check_failed", failed, undefined, []), "Check failed: Total. Expected $21.60. Saw $19.44.");
});

test("checkLine reads the first failed check and counts the others", () => {
  const m = (checks: unknown): Mission => ({ ...base, status: "failed", result: { checks } });
  assert.equal(checkLine(m([])), null);
  assert.equal(checkLine({ ...base, result: null }), null);
  assert.equal(checkLine(m([{ name: "Total", expected: "$9.00", saw: "$9.00", passed: true }])), null);
  assert.equal(
    checkLine(
      m([
        { name: "Message.", expected: "Coupon already applied.", saw: "SAVE10 applied.", passed: false },
        { name: "Total", expected: "$21.60", saw: "$19.44", passed: false },
        { name: "Shipping", expected: "$0.00", saw: "$4.00", passed: false },
      ]),
    ),
    "Check failed: Message. Expected Coupon already applied. Saw SAVE10 applied. 2 more failed.",
  );
  assert.equal(checkLine(m([{ name: "Total", expected: "", saw: "", passed: false }])), "Check failed: Total.");
});

test("the fake run moves through the new states and ends with them", () => {
  const realNow = Date.now;
  const t0 = realNow();
  const at = (s: number) => {
    Date.now = () => t0 + s * 1000;
    const st = getFakeStatus(FAKE_RUN_ID);
    return { st, states: statesOf(st, t0 + s * 1000).map((r) => r.state) };
  };
  try {
    Date.now = () => t0;
    resetFakeClock();
    const seen = new Set<TileState>();
    for (let s = 0; s <= 40; s += 0.5) for (const x of at(s).states) seen.add(x);
    const want: TileState[] = [
      "queued",
      "waiting",
      "starting",
      "testing",
      "rechecking",
      "check_failed",
      "bug",
      "possible",
      "old_bug",
      "not_confirmed",
      "could_not_run",
      "passed",
    ];
    for (const w of want) assert.ok(seen.has(w), `state ${w} shows at some time`);
    assert.equal(at(1).st.run.status, "planning");
    assert.ok(at(10).st.run.next_start_at, "rate limited at 10 s");
    const end = at(35);
    assert.equal(end.st.run.status, "done");
    assert.deepEqual(countOf(end.states), { passed: 5, bug: 1, possible: 1, not_confirmed: 1, old_bug: 1, could_not_run: 1 });
    // The bug keeps its step pictures and its Computer.
    const bug = end.st.missions.find((m) => m.persona === "Coupon abuser" && m.kind === "preview")!;
    assert.equal((bug.result as { step_shots: unknown[] }).step_shots.length, 4);
    assert.equal(bug.kept, true);
    assert.equal(bug.has_computer, true);
  } finally {
    Date.now = realNow;
  }
});

test("the stage line counts a user that needs a person, and the computers that start", () => {
  const run = { status: "running", next_start_at: null } as Run;
  const help: Mission = { ...base, id: "h", status: "needs_you" };
  const start: Mission = { ...base, id: "s", status: "running", has_computer: false };
  const test1: Mission = { ...base, id: "t", status: "running", has_computer: true };
  assert.deepEqual(stageOf(run, [help, start, test1]), {
    text: "1 user needs you. Open the yellow card.",
    detail: "Starting Pine computers: 1 of 2 ready. 1 user is testing now.",
  });
  assert.equal(stageOf(run, [help, { ...help, id: "h2" }])?.text, "2 users need you. Open the yellow card.");
  assert.equal(stageOf(run, [{ ...base }])?.text, "1 user waits for a free computer.");
  assert.equal(stageOf(run, [{ ...base }, { ...base, id: "q2" }])?.text, "2 users wait for a free computer.");
  assert.equal(stageOf({ ...run, status: "planning" }, [])?.text, "Reading the PR and planning 10 missions with Claude.");
  assert.equal(stageOf({ ...run, status: "done" }, []), null);
});

test("clock helpers: m:ss, seconds since and seconds until", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7.9), "0:07");
  assert.equal(formatElapsed(272), "4:32");
  assert.equal(formatElapsed(-3), "0:00");
  assert.equal(secondsSince(null, NOW), null);
  assert.equal(secondsSince("bad", NOW), null);
  assert.equal(secondsSince(later(-12), NOW), 12);
  // A start a little in the future (clock skew) reads as 0, not a negative time.
  assert.equal(secondsSince(later(3), NOW), 0);
  assert.equal(secondsUntil(null, NOW), null);
  assert.equal(secondsUntil(later(-1), NOW), null);
  assert.equal(secondsUntil(later(0), NOW), null);
  assert.equal(secondsUntil(later(0.2), NOW), 1);
  assert.equal(secondsUntil(later(19.5), NOW), 20);
});
