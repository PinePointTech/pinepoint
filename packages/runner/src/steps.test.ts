import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleEvenly } from "./pine";

test("sampleEvenly keeps a short list as it is", () => {
  assert.deepEqual(sampleEvenly([1, 2, 3], 12), [1, 2, 3]);
});

test("sampleEvenly keeps the first and the last item of a long list", () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const picked = sampleEvenly(items, 12);
  assert.equal(picked.length, 12);
  assert.equal(picked[0], 0);
  assert.equal(picked.at(-1), 39);
  assert.deepEqual([...picked].sort((a, b) => a - b), picked);
  assert.equal(new Set(picked).size, 12);
});

test("sampleEvenly with max 1 keeps the last item", () => {
  assert.deepEqual(sampleEvenly([1, 2, 3], 1), [3]);
});
