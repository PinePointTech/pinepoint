import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mission } from "@pinepoint/core";
import type { Complete } from "./client";
import { buildPlannerPrompt, clampTargets, extractJson, parsePlan, planMissions, PlannerError } from "./planner";

// These tests use a fake model. No network, no key.

const planted = readFileSync(join(import.meta.dirname, "../fixtures/vihuynh72-pinepoint-pr-6.diff"), "utf8");
const qaMd = readFileSync(join(import.meta.dirname, "../../../apps/demo-store/qa.md"), "utf8");
const input = { diff: planted, qaMd, changedFiles: [{ path: "apps/demo-store/lib/cart.ts", content: "// cart" }] };

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    lens: "Abuse",
    persona: "Coupon abuser",
    goal: "Apply SAVE10 two times and read the total.",
    checks: [{ name: "Total after SAVE10 two times", expected: "$21.60" }],
    target: { path: "apps/demo-store/lib/cart.ts", line: 35 },
    newFeature: false,
    ...overrides,
  };
}

const tenMissions = () => Array.from({ length: 10 }, () => mission());

function fakeComplete(replies: string[]): { complete: Complete; prompts: string[] } {
  const prompts: string[] = [];
  const queue = [...replies];
  const complete: Complete = async ({ prompt }) => {
    prompts.push(prompt);
    const text = queue.shift();
    if (text === undefined) throw new Error("The fake model has no more replies.");
    return { text, usage: { inputTokens: 100, outputTokens: 50 } };
  };
  return { complete, prompts };
}

test("buildPlannerPrompt has the rules, qa.md, the numbered diff and the changed files", () => {
  const prompt = buildPlannerPrompt(input);
  assert.match(prompt, /1\. Write exactly 10 missions\./);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /Coupon codes: SAVE10, FREESHIP\./);
  assert.match(prompt, /^\s+35 \+ {3}if \(!\(code in PERCENT_COUPONS\)/m);
  assert.match(prompt, /--- apps\/demo-store\/lib\/cart\.ts ---\n\/\/ cart/);
});

test("extractJson strips code fences and text around the object", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('Here you go:\n{"a":1}\nThanks'), '{"a":1}');
  assert.throws(() => extractJson("no json here"), /no JSON object/);
});

test("parsePlan reports zod errors as text", () => {
  const bad = parsePlan(JSON.stringify({ missions: [mission({ lens: "Chaos" as Mission["lens"] })] }));
  assert.ok("error" in bad);
  assert.match(bad.error, /missions/);
  assert.match(bad.error, /exactly 10 missions/);
});

test("clampTargets sets a target to null when the line is not a + line of the diff", () => {
  const { missions, droppedTargets } = clampTargets(
    [
      mission({ target: { path: "apps/demo-store/lib/cart.ts", line: 35 } }),
      mission({ target: { path: "apps/demo-store/lib/cart.ts", line: 31 } }),
      mission({ target: { path: "apps/demo-store/lib/products.ts", line: 3 } }),
      mission({ target: null }),
    ],
    planted,
  );
  assert.deepEqual(missions.map((m) => m.target), [{ path: "apps/demo-store/lib/cart.ts", line: 35 }, null, null, null]);
  assert.deepEqual(droppedTargets, [
    { index: 1, path: "apps/demo-store/lib/cart.ts", line: 31 },
    { index: 2, path: "apps/demo-store/lib/products.ts", line: 3 },
  ]);
});

test("planMissions returns 10 missions on a valid first reply and sums usage", async () => {
  const { complete, prompts } = fakeComplete([JSON.stringify({ missions: tenMissions() })]);
  const result = await planMissions(input, { complete, model: "fake" });
  assert.equal(result.missions.length, 10);
  assert.equal(result.attempts, 1);
  assert.equal(result.model, "fake");
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 });
  assert.equal(prompts.length, 1);
});

test("planMissions retries one time with the error text, then clamps targets", async () => {
  const valid = tenMissions();
  valid[3] = mission({ target: { path: "apps/demo-store/lib/cart.ts", line: 36 } });
  const { complete, prompts } = fakeComplete([
    "```json\n" + JSON.stringify({ missions: tenMissions().slice(0, 9) }) + "\n```",
    JSON.stringify({ missions: valid }),
  ]);
  const attempts: Array<{ attempt: number; error: string | null }> = [];
  const result = await planMissions(input, { complete, model: "fake", onAttempt: (a) => attempts.push(a) });

  assert.equal(result.attempts, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /did not validate/);
  assert.match(prompts[1]!, /exactly 10 missions/);
  assert.equal(attempts[0]!.attempt, 1);
  assert.match(attempts[0]!.error!, /exactly 10 missions/);
  assert.equal(attempts[1]!.error, null);
  assert.equal(result.missions[3]!.target, null);
  assert.deepEqual(result.droppedTargets, [{ index: 3, path: "apps/demo-store/lib/cart.ts", line: 36 }]);
  assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 100 });
});

test("planMissions throws PlannerError after two bad replies", async () => {
  const { complete } = fakeComplete(["not json", '{"missions": []}']);
  await assert.rejects(planMissions(input, { complete, model: "fake" }), (err: unknown) => {
    assert.ok(err instanceof PlannerError);
    assert.equal(err.attempts, 2);
    assert.match(err.message, /exactly 10 missions/);
    assert.equal(err.lastReply, '{"missions": []}');
    return true;
  });
});
