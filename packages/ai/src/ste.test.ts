import { test } from "node:test";
import assert from "node:assert/strict";
import type { Complete } from "./client";
import { buildSteRewritePrompt, lintSte, parseSteReply, rewriteSte, splitSentences, type SteText } from "./ste";

// These tests use a fake model. No network, no key.

const good: SteText = {
  title: "SAVE10 applies two times",
  steps: ["Open the store.", "Add the Sage linen apron to the cart.", "Enter SAVE10. Click Apply.", "Enter SAVE10 again. Click Apply."],
  expected: "The total shows $21.60.",
  saw: "The total shows $19.44.",
  problem: true,
};

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

test("splitSentences does not split on a decimal price", () => {
  assert.deepEqual(splitSentences("The total shows $21.60. The message says SAVE10 applied."), [
    "The total shows $21.60",
    "The message says SAVE10 applied",
  ]);
});

test("lintSte passes good STE text", () => {
  assert.deepEqual(lintSte(good), []);
});

test("lintSte catches a semicolon", () => {
  const errors = lintSte({ ...good, saw: "The total shows $19.44; the coupon applied again." });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /saw has a semicolon/);
});

test("lintSte catches a step with 9 words", () => {
  const errors = lintSte({ ...good, steps: ["Open the store and add the apron to cart."] });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /step 1 has 9 words, the limit is 8/);
});

test("lintSte catches a sentence with 21 words", () => {
  const long = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ") + ".";
  const errors = lintSte({ ...good, expected: long });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /expected has a sentence with 21 words, the limit is 20/);
});

test("lintSte skips null expected and saw", () => {
  assert.deepEqual(lintSte({ title: "A note", steps: [], expected: null, saw: null }), []);
});

test("buildSteRewritePrompt has the rules and the draft", () => {
  const prompt = buildSteRewritePrompt(good);
  assert.match(prompt, /1\. Use active voice and the simple present tense\./);
  assert.match(prompt, /4\. Do not use semicolons\./);
  assert.match(prompt, /## Draft to rewrite/);
  assert.match(prompt, /SAVE10 applies two times/);
});

test("parseSteReply strips code fences and defaults null fields", () => {
  const parsed = parseSteReply('```json\n{"title":"T","steps":["Open the store."]}\n```');
  assert.ok("text" in parsed);
  assert.deepEqual(parsed.text, { title: "T", steps: ["Open the store."], expected: null, saw: null, problem: true });
  const noProblem = parseSteReply('{"title":"T","steps":[],"problem":false}');
  assert.ok("text" in noProblem);
  assert.equal(noProblem.text.problem, false);
  const bad = parseSteReply("no json");
  assert.ok("error" in bad);
});

test("rewriteSte returns the first reply when it passes the lint", async () => {
  const { complete, prompts } = fakeComplete([JSON.stringify(good)]);
  const result = await rewriteSte({ ...good, title: "raw" }, { complete, model: "fake" });
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.lintErrors, []);
  assert.deepEqual(result.text, good);
  assert.equal(prompts.length, 1);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 });
});

test("rewriteSte retries one time with the lint errors and keeps the second text even when it fails", async () => {
  const first = { ...good, steps: ["Open the store and add the apron to the cart now."] };
  const second = { ...good, saw: "The total shows $19.44; it is wrong." };
  const { complete, prompts } = fakeComplete([JSON.stringify(first), JSON.stringify(second)]);
  const result = await rewriteSte(good, { complete, model: "fake" });
  assert.equal(result.attempts, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /did not pass the lint/);
  assert.match(prompts[1]!, /step 1 has 11 words/);
  assert.deepEqual(result.text, second);
  assert.equal(result.lintErrors.length, 1);
  assert.match(result.lintErrors[0]!, /semicolon/);
  assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 100 });
});

test("rewriteSte keeps the draft text when both replies do not parse", async () => {
  const { complete } = fakeComplete(["not json", "still not json"]);
  const result = await rewriteSte(good, { complete, model: "fake" });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.text, good);
  assert.match(result.lintErrors[0]!, /not valid JSON|no JSON object/);
});
