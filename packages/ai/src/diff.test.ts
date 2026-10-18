import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { annotateDiff, changedPaths, isInsideHunk, isRightSideLine, rightSideHunkLines, rightSideLines } from "./diff";

const planted = readFileSync(join(import.meta.dirname, "../fixtures/vihuynh72-pinepoint-pr-6.diff"), "utf8");

test("rightSideLines finds the + lines of the planted diff by new line number", () => {
  const lines = rightSideLines(planted);
  assert.deepEqual([...lines.keys()], ["apps/demo-store/lib/cart.ts", "apps/demo-store/qa.md"]);

  // Hunk @@ -10,6 +10,8 @@: context 10,11,12 then + at 13 and 14.
  // Hunk @@ -30,12 +32,9 @@: context 32,33,34 then + at 35; the removed lines have no right side.
  // Hunk @@ -64,8 +63,11 @@: context 63,64,65 then + at 66, context 67, + at 68, 69, 70.
  // Checked against apps/demo-store/lib/cart.ts and qa.md at the PR head.
  assert.deepEqual([...lines.get("apps/demo-store/lib/cart.ts")!].sort((a, b) => a - b), [13, 14, 35, 66, 68, 69, 70]);
  assert.deepEqual([...lines.get("apps/demo-store/qa.md")!].sort((a, b) => a - b), [31, 32, 36, 48, 49]);
});

test("isRightSideLine rejects removed lines, context lines and unknown paths", () => {
  const lines = rightSideLines(planted);
  assert.equal(isRightSideLine(lines, "apps/demo-store/lib/cart.ts", 35), true);
  assert.equal(isRightSideLine(lines, "apps/demo-store/lib/cart.ts", 36), false, "a context line");
  assert.equal(isRightSideLine(lines, "apps/demo-store/lib/cart.ts", 31), false, "the old line of the removed check");
  assert.equal(isRightSideLine(lines, "apps/demo-store/lib/products.ts", 1), false);
});

test("rightSideHunkLines includes the context lines of each hunk", () => {
  const lines = rightSideHunkLines(planted);
  // Hunk @@ -30,12 +32,9 @@ shows right-side lines 32 to 40. Hunk @@ -10,6 +10,8 @@ shows 10 to 17.
  const cart = [...lines.get("apps/demo-store/lib/cart.ts")!].sort((a, b) => a - b);
  assert.deepEqual(cart.filter((n) => n >= 32 && n <= 40), [32, 33, 34, 35, 36, 37, 38, 39, 40]);
  assert.deepEqual(cart.filter((n) => n < 32), [10, 11, 12, 13, 14, 15, 16, 17]);
  assert.equal(cart.includes(18), false, "line 18 is between two hunks");
});

test("isInsideHunk accepts a range inside one hunk and rejects the rest", () => {
  const lines = rightSideHunkLines(planted);
  const path = "apps/demo-store/lib/cart.ts";
  assert.equal(isInsideHunk(lines, path, 35, 37), true, "the changed if and the two context lines after it");
  assert.equal(isInsideHunk(lines, path, 36, 38), true, "context lines only");
  assert.equal(isInsideHunk(lines, path, 35, 35), true, "one line");
  assert.equal(isInsideHunk(lines, path, 30, 35), false, "starts before the hunk");
  assert.equal(isInsideHunk(lines, path, 50, 52), false, "no hunk shows these lines");
  assert.equal(isInsideHunk(lines, path, 17, 32), false, "crosses the gap between two hunks");
  assert.equal(isInsideHunk(lines, path, 37, 35), false, "end before start");
  assert.equal(isInsideHunk(lines, "apps/demo-store/lib/products.ts", 1, 1), false, "path not in the diff");
});

test("rightSideLines skips deleted files and handles new files", () => {
  const diff = [
    "diff --git a/old.ts b/old.ts",
    "deleted file mode 100644",
    "--- a/old.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-a",
    "-b",
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1,3 @@",
    "+x",
    "+y",
    "+z",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  const lines = rightSideLines(diff);
  assert.deepEqual(changedPaths(diff), ["new.ts"]);
  assert.deepEqual([...lines.get("new.ts")!], [1, 2, 3]);
});

test("annotateDiff prefixes right-side lines with their new line number", () => {
  const annotated = annotateDiff(planted);
  assert.match(annotated, /^\s+35 \+   if \(!\(code in PERCENT_COUPONS\) && !SHIPPING_COUPONS\.has\(code\)\) \{$/m);
  assert.match(annotated, /^ {6}- {5}return \{ cart, message: "Coupon already applied\." \};$/m);
  assert.match(annotated, /^\s+14 \+ const SHIPPING_COUPONS = new Set\(\["FREESHIP"\]\);$/m);
  // Headers are kept as they are.
  assert.match(annotated, /^\+\+\+ b\/apps\/demo-store\/lib\/cart\.ts$/m);
});
