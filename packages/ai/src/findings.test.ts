import { test } from "node:test";
import assert from "node:assert/strict";
import type { MissionRow } from "@pinepoint/core";
import { groupFindings, readMissionResult, withShotFallback } from "./findings";

// Pure grouping tests on fixture rows. No network, no database.

const RUN = "00000000-0000-4000-8000-000000000001";
let counter = 0;
const id = () => `00000000-0000-4000-8000-0000000000${String(++counter).padStart(2, "0")}`;

type Check = { name: string; expected: string; saw?: string; passed: boolean };

function mission(overrides: Partial<MissionRow> & { checksResult?: Check[]; notes?: unknown[]; errors?: unknown[]; steps?: string[] }): MissionRow {
  const { checksResult, notes, errors, steps, ...rest } = overrides;
  const result =
    checksResult || notes || errors || steps
      ? {
          checks: (checksResult ?? []).map((c) => ({ saw: "", ...c })),
          steps: steps ?? ["Open the store."],
          notes: notes ?? [],
          errors: errors ?? [],
          blocked: false,
        }
      : null;
  return {
    id: id(),
    run_id: RUN,
    kind: "preview",
    parent_id: null,
    lens: "Abuse",
    persona: "Coupon abuser",
    goal: "Apply SAVE10 two times.",
    checks: null,
    target_path: "apps/demo-store/lib/cart.ts",
    target_line: 35,
    new_feature: false,
    url: "https://preview.example",
    status: "passed",
    result,
    screenshot_url: null,
    usage: null,
    pine_enc: null,
    kept: false,
    started_at: null,
    finished_at: null,
    ...rest,
  };
}

const COUPON = "Total after SAVE10 two times";
const failCoupon: Check = { name: COUPON, expected: "$21.60", saw: "$19.44", passed: false };
const passCoupon: Check = { name: COUPON, expected: "$21.60", saw: "$21.60", passed: true };

/** The planted run: 9 passing previews, 1 failing preview with a confirming flake and a passing production run. */
function plantedRun() {
  const preview = mission({
    status: "failed",
    checksResult: [failCoupon],
    screenshot_url: "https://blob.example/fail.png",
    steps: ["Open the store.", "Add the apron.", "Apply SAVE10 two times."],
  });
  const flake = mission({ kind: "flake", parent_id: preview.id, status: "failed", checksResult: [failCoupon] });
  const production = mission({
    kind: "production",
    parent_id: preview.id,
    status: "passed",
    url: "https://prod.example",
    checksResult: [passCoupon],
  });
  const passing = Array.from({ length: 9 }, (_, i) =>
    mission({ lens: "Flow", persona: `Shopper ${i}`, checksResult: [{ name: `Check ${i}`, expected: "x", saw: "x", passed: true }] }),
  );
  return { preview, flake, production, missions: [...passing, preview, flake, production] };
}

test("readMissionResult parses the runner's merged result and returns null for a missing one", () => {
  const m = mission({ checksResult: [passCoupon] });
  m.result = { ...m.result, terminalReason: "done", summary: "ok" };
  assert.equal(readMissionResult(m)?.checks.length, 1);
  assert.equal(readMissionResult(mission({})), null);
});

test("the planted run gives exactly one bug finding for the coupon", () => {
  const { preview, missions } = plantedRun();
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  const f = findings[0]!;
  assert.equal(f.level, "bug");
  assert.deepEqual(f.checkNames, [COUPON]);
  assert.deepEqual(f.missionIds, [preview.id]);
  assert.equal(f.expected, "$21.60");
  assert.equal(f.saw, "$19.44");
  assert.equal(f.productionSaw, "$21.60");
  assert.equal(f.path, "apps/demo-store/lib/cart.ts");
  assert.equal(f.line, 35);
  assert.equal(f.screenshotUrl, "https://blob.example/fail.png");
  assert.deepEqual(f.text.steps, ["Open the store.", "Add the apron.", "Apply SAVE10 two times."]);
  assert.match(f.text.title, /expected "\$21\.60", saw "\$19\.44"/);
});

const MESSAGE = "Message after second SAVE10";
const failMessage: Check = { name: MESSAGE, expected: "Coupon already applied.", saw: "SAVE10 applied.", passed: false };
const passMessage: Check = { name: MESSAGE, expected: "Coupon already applied.", saw: "Coupon already applied.", passed: true };

test("one mission with two failed checks is one finding that lists both", () => {
  const { preview, flake, production, missions } = plantedRun();
  preview.result = { ...preview.result, checks: [failMessage, failCoupon] };
  flake.result = { ...flake.result, checks: [failMessage, failCoupon] };
  production.result = { ...production.result, checks: [passMessage, passCoupon] };
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  const f = findings[0]!;
  assert.equal(f.level, "bug");
  assert.deepEqual(f.checkNames, [MESSAGE, COUPON]);
  assert.equal(f.expected, `${MESSAGE}: Coupon already applied. ${COUPON}: $21.60.`);
  assert.equal(f.saw, `${MESSAGE}: SAVE10 applied. ${COUPON}: $19.44.`);
  assert.equal(f.productionSaw, `${MESSAGE}: Coupon already applied. ${COUPON}: $21.60.`);
});

test("two checks where production fails only one stay a bug, not an old_bug", () => {
  const { preview, flake, production, missions } = plantedRun();
  preview.result = { ...preview.result, checks: [failMessage, failCoupon] };
  flake.result = { ...flake.result, checks: [failMessage, failCoupon] };
  production.result = { ...production.result, checks: [failMessage, passCoupon] };
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "bug");
});

test("a mission where only one of two failed checks is confirmed keeps only that check", () => {
  const { preview, flake, missions } = plantedRun();
  preview.result = { ...preview.result, checks: [failMessage, failCoupon] };
  flake.result = { ...flake.result, checks: [passMessage, failCoupon] };
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "bug");
  assert.deepEqual(findings[0]!.checkNames, [COUPON]);
  assert.equal(findings[0]!.expected, "$21.60");
});

test("production failing the same check gives old_bug with production_saw", () => {
  const { production, missions } = plantedRun();
  production.status = "failed";
  production.result = { ...production.result, checks: [failCoupon] };
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "old_bug");
  assert.equal(findings[0]!.productionSaw, "$19.44");
});

test("a passing flake re-run drops the failure", () => {
  const { flake, missions } = plantedRun();
  flake.status = "passed";
  flake.result = { ...flake.result, checks: [passCoupon] };
  assert.deepEqual(groupFindings(missions), []);
});

test("a flake re-run with no verdict downgrades the failure to possible", () => {
  const { flake, missions } = plantedRun();
  flake.status = "error";
  flake.result = { reason: "The agent did not write result.json." };
  const findings = groupFindings(missions);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "possible");
  assert.deepEqual(findings[0]!.checkNames, [COUPON]);
  assert.equal(findings[0]!.expected, "$21.60");
});

test("no production run leaves production_saw null and the level bug", () => {
  const { missions, production } = plantedRun();
  const findings = groupFindings(missions.filter((m) => m.id !== production.id));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "bug");
  assert.equal(findings[0]!.productionSaw, null);
});

test("two preview missions with the same check name and target path form one finding", () => {
  const { missions } = plantedRun();
  const second = mission({ status: "failed", persona: "Second abuser", checksResult: [failCoupon], target_line: 36 });
  const secondFlake = mission({ kind: "flake", parent_id: second.id, status: "failed", checksResult: [failCoupon] });
  const findings = groupFindings([...missions, second, secondFlake]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.missionIds.length, 2);
  assert.deepEqual(findings[0]!.checkNames, [COUPON]);
  assert.equal(findings[0]!.missionIds[1], second.id);
  // The first member's line stays.
  assert.equal(findings[0]!.line, 35);
});

test("the same check name on another target path is a separate finding", () => {
  const { missions } = plantedRun();
  const other = mission({ status: "failed", checksResult: [failCoupon], target_path: "apps/demo-store/app/page.tsx", target_line: 3 });
  const otherFlake = mission({ kind: "flake", parent_id: other.id, status: "failed", checksResult: [failCoupon] });
  assert.equal(groupFindings([...missions, other, otherFlake]).length, 2);
});

test("notes without a failed check give a possible issue with the notes as the raw title", () => {
  const noted = mission({
    lens: "Access",
    checksResult: [passCoupon],
    notes: ["The coupon message is not announced to screen readers.", { kind: "contrast", text: "low" }],
  });
  const findings = groupFindings([noted]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "possible");
  assert.deepEqual(findings[0]!.checkNames, []);
  assert.deepEqual(findings[0]!.missionIds, [noted.id]);
  assert.equal(findings[0]!.expected, null);
  assert.match(findings[0]!.text.title, /not announced to screen readers/);
  assert.match(findings[0]!.text.title, /"kind":"contrast"/);
});

test("on-screen errors count like notes", () => {
  const withErrors = mission({ checksResult: [passCoupon], errors: ["The page shows a 404 image."] });
  const findings = groupFindings([withErrors]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.level, "possible");
});

test("a passing mission without notes gives nothing, and flake or production rows are never findings on their own", () => {
  const { preview, flake, production } = plantedRun();
  // Without the preview, the children have no parent in the list and are not previews.
  assert.deepEqual(groupFindings([flake, production]), []);
  void preview;
  assert.deepEqual(groupFindings([mission({ checksResult: [passCoupon] })]), []);
});

test("withShotFallback fills a missing screenshot_url from the stored pictures and keeps a written one", () => {
  const { preview, flake, production, missions } = plantedRun();
  const bare = { ...preview, screenshot_url: null };
  const list = missions.map((m) => (m.id === preview.id ? bare : m));
  const shots = new Map([
    [preview.id, "/api/shots/11111111-1111-4111-8111-111111111111"],
    [flake.id, "/api/shots/22222222-2222-4222-8222-222222222222"],
  ]);

  const filled = withShotFallback(list, shots);
  assert.equal(filled.find((m) => m.id === preview.id)!.screenshot_url, "/api/shots/11111111-1111-4111-8111-111111111111");
  assert.equal(filled.find((m) => m.id === production.id)!.screenshot_url, null, "no stored picture, no change");
  assert.equal(bare.screenshot_url, null, "the input rows do not change");

  const findings = groupFindings(filled);
  assert.equal(findings[0]!.screenshotUrl, "/api/shots/11111111-1111-4111-8111-111111111111");

  const written = withShotFallback(missions, new Map([[preview.id, "/api/shots/other"]]));
  assert.equal(written.find((m) => m.id === preview.id)!.screenshot_url, "https://blob.example/fail.png");
  assert.equal(withShotFallback(missions, new Map()), missions);
});
