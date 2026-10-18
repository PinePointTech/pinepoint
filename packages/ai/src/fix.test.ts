import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Complete } from "./client";
import {
  FIX_RULES,
  FixError,
  buildFixPrompt,
  parseFixReply,
  proposeFix,
  readStoredFix,
  validateFix,
  type Fix,
  type FixInput,
} from "./fix";

const planted = readFileSync(join(import.meta.dirname, "../fixtures/vihuynh72-pinepoint-pr-6.diff"), "utf8");

const input: FixInput = {
  diff: planted,
  title: "SAVE10 applies two times",
  steps: ["Open the store.", "Add the Sage linen apron to the cart.", "Enter SAVE10. Click Apply.", "Enter SAVE10 again. Click Apply."],
  expected: "The total shows $21.60.",
  saw: "The total shows $19.44.",
  errors: ["TypeError: x is not a function"],
  screenshotUrl: "https://blob.example.com/fail.png",
  files: [{ path: "apps/demo-store/lib/cart.ts", content: "export const a = 1;\n" }, { path: "apps/demo-store/qa.md" }],
};

const goodFix: Fix = {
  path: "apps/demo-store/lib/cart.ts",
  startLine: 35,
  endLine: 37,
  replacement: [
    "  if (!(code in PERCENT_COUPONS) && !SHIPPING_COUPONS.has(code)) {",
    '    return { cart, message: "Coupon not valid." };',
    "  }",
    "  if (cart.coupons.includes(code)) {",
    '    return { cart, message: "Coupon already applied." };',
    "  }",
  ].join("\n"),
  explanation: "The change removed the check for an applied coupon. The fix puts the check back.",
  confidence: "high",
};

function fakeComplete(replies: string[]): { complete: Complete; calls: Array<Parameters<Complete>[0]> } {
  const calls: Array<Parameters<Complete>[0]> = [];
  const complete: Complete = async (request) => {
    calls.push(request);
    const text = replies[Math.min(calls.length, replies.length) - 1]!;
    return { text, usage: { inputTokens: 100, outputTokens: 10 } };
  };
  return { complete, calls };
}

test("buildFixPrompt has the rules, the report, the errors, the annotated diff and the files", () => {
  const prompt = buildFixPrompt(input);
  for (const [i, rule] of FIX_RULES.entries()) assert.ok(prompt.includes(`${i + 1}. ${rule}`), `rule ${i + 1}`);
  assert.ok(prompt.includes("Title: SAVE10 applies two times"));
  assert.ok(prompt.includes("4. Enter SAVE10 again. Click Apply."));
  assert.ok(prompt.includes("Expected: The total shows $21.60."));
  assert.ok(prompt.includes("- TypeError: x is not a function"));
  assert.ok(prompt.includes("The image is the failure screenshot."));
  assert.match(prompt, /^\s+35 \+   if \(!\(code in PERCENT_COUPONS\)/m, "annotated diff");
  assert.ok(prompt.includes("--- apps/demo-store/lib/cart.ts ---\nexport const a = 1;"));
  assert.ok(prompt.includes("--- apps/demo-store/qa.md ---\n(no content"));
});

test("buildFixPrompt says when there is no screenshot and no error", () => {
  const prompt = buildFixPrompt({ ...input, screenshotUrl: null, errors: [] });
  assert.ok(prompt.includes("No failure screenshot."));
  assert.ok(prompt.includes("## Errors the simulated user saw\n(none)"));
});

test("parseFixReply accepts a fix, the null form, and code fences", () => {
  const fix = parseFixReply(JSON.stringify(goodFix));
  assert.ok("reply" in fix && !("fix" in fix.reply) && fix.reply.path === goodFix.path);

  const none = parseFixReply('```json\n{"fix": null, "reason": "The bug is outside the diff."}\n```');
  assert.ok("reply" in none && "fix" in none.reply && none.reply.reason === "The bug is outside the diff.");

  const bad = parseFixReply('{"path": "a.ts", "startLine": 5, "endLine": 3, "replacement": "", "explanation": "x", "confidence": "high"}');
  assert.ok("error" in bad && /startLine/.test(bad.error));

  const notJson = parseFixReply("I cannot fix this.");
  assert.ok("error" in notJson);
});

test("validateFix accepts a range inside one hunk with a short STE explanation", () => {
  assert.deepEqual(validateFix(goodFix, planted), []);
  assert.deepEqual(validateFix({ ...goodFix, startLine: 36, endLine: 38 }, planted), [], "context lines only");
});

test("validateFix rejects a path outside the diff", () => {
  const errors = validateFix({ ...goodFix, path: "apps/demo-store/lib/products.ts" }, planted);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /not a file with a right side in the diff/);
});

test("validateFix rejects a range that leaves the hunk or has only left-side lines", () => {
  const outside = validateFix({ ...goodFix, startLine: 50, endLine: 52 }, planted);
  assert.equal(outside.length, 1);
  assert.match(outside[0]!, /lines 50-52 .* not all inside one hunk/);
  assert.match(outside[0]!, /10-17, 32-40, 63-73/, "tells the model which lines the diff shows");

  const crossing = validateFix({ ...goodFix, startLine: 17, endLine: 32 }, planted);
  assert.equal(crossing.length, 1);
});

test("validateFix rejects a long explanation and a semicolon", () => {
  const long = validateFix({ ...goodFix, explanation: "One. Two. Three. Four." }, planted);
  assert.equal(long.length, 1);
  assert.match(long[0]!, /4 sentences, the limit is 3/);

  const semicolon = validateFix({ ...goodFix, explanation: "One; two." }, planted);
  assert.equal(semicolon.length, 1);
  assert.match(semicolon[0]!, /^explanation has a semicolon/);
});

test("proposeFix returns the fix on the first valid reply and sends the screenshot as an image", async () => {
  const { complete, calls } = fakeComplete([JSON.stringify(goodFix)]);
  const result = await proposeFix(input, { model: "test-model", complete });
  assert.deepEqual(result.stored.fix, goodFix);
  assert.equal(result.stored.reason, null);
  assert.equal(result.stored.attempts, 1);
  assert.equal(result.stored.model, "test-model");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.images, [{ url: "https://blob.example.com/fail.png" }]);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 10 });
});

test("proposeFix retries one time with the errors, then keeps the valid reply", async () => {
  const bad = { ...goodFix, startLine: 50, endLine: 52 };
  const { complete, calls } = fakeComplete([JSON.stringify(bad), JSON.stringify(goodFix)]);
  const attempts: Array<{ attempt: number; error: string | null }> = [];
  const result = await proposeFix(input, { model: "m", complete, onAttempt: (a) => attempts.push(a) });
  assert.equal(result.stored.attempts, 2);
  assert.deepEqual(result.stored.fix, goodFix);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.prompt.includes("## Your previous reply did not validate"));
  assert.ok(calls[1]!.prompt.includes("lines 50-52"));
  assert.equal(attempts[0]!.attempt, 1);
  assert.ok(attempts[0]!.error);
  assert.deepEqual(attempts[1], { attempt: 2, error: null });
  assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 20 });
});

test("proposeFix throws FixError after two bad replies", async () => {
  const { complete } = fakeComplete(["nope", "still nope"]);
  await assert.rejects(
    () => proposeFix(input, { model: "m", complete }),
    (err: unknown) => err instanceof FixError && err.attempts === 2 && err.lastReply === "still nope",
  );
});

test("proposeFix keeps the null form with its reason", async () => {
  const { complete } = fakeComplete(['{"fix": null, "reason": "The bug is in a file the diff does not touch."}']);
  const result = await proposeFix(input, { model: "m", complete });
  assert.equal(result.stored.fix, null);
  assert.equal(result.stored.reason, "The bug is in a file the diff does not touch.");
});

test("readStoredFix reads findings.fix back and rejects other values", () => {
  const stored = { fix: goodFix, reason: null, model: "m", attempts: 1, createdAt: "2026-10-17T23:00:00.000Z" };
  assert.deepEqual(readStoredFix(stored), stored);
  assert.deepEqual(readStoredFix({ fix: null, reason: "r", model: "m", attempts: 2, createdAt: "2026-10-17T23:00:00.000Z" })?.fix, null);
  assert.equal(readStoredFix(null), null);
  assert.equal(readStoredFix("text"), null);
  assert.equal(readStoredFix({ path: "a" }), null);
});
