import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteImageUrl, bugCommentBody, summaryBody, type ReviewFinding } from "./review-text";

const BASE = "https://pinepoint.example/";
const RUN = "run-1";

function finding(over: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: "f1",
    level: "bug",
    title: "Coupon applies two times",
    steps: ["Open the store.", "Enter SAVE10. Click Apply."],
    expected: "$21.60",
    saw: "$19.44",
    production_saw: "$21.60",
    screenshot_url: "https://blob.example/shot.png",
    path: "apps/demo-store/lib/cart.ts",
    line: 38,
    persona: "Coupon abuser",
    lens: "Abuse",
    ...over,
  };
}

test("summary with possible issues", () => {
  const body = summaryBody({
    appBaseUrl: BASE,
    runId: RUN,
    author: "vihuynh72",
    bugs: 1,
    passed: 7,
    blocked: 1,
    possible: [finding({ title: "A" }), finding({ title: "B" })],
    oldBugs: [],
    bugsWithoutLine: [],
  });
  assert.equal(
    body,
    [
      "PinePoint tested this preview with 10 simulated users. @vihuynh72",
      "Bugs: 1. Possible issues: 2. Passed: 7. Blocked: 1.",
      "Open the run: https://pinepoint.example/app?run=run-1",
      "<details><summary>Possible issues (2)</summary>",
      "1. A",
      "2. B",
      "</details>",
    ].join("\n"),
  );
});

test("summary without possible issues, with old bugs and bugs with no line", () => {
  const body = summaryBody({
    appBaseUrl: BASE,
    runId: RUN,
    author: "vihuynh72",
    bugs: 1,
    passed: 10,
    blocked: 0,
    possible: [],
    oldBugs: [finding({ title: "Old one" })],
    bugsWithoutLine: [finding({ title: "No line" })],
  });
  assert.equal(
    body,
    [
      "PinePoint tested this preview with 10 simulated users. @vihuynh72",
      "Bugs: 1. Possible issues: 0. Passed: 10. Blocked: 0.",
      "Open the run: https://pinepoint.example/app?run=run-1",
      "",
      "Bugs with no target line:",
      "1. No line",
      "",
      "Old bugs (production has them too):",
      "1. Old one",
    ].join("\n"),
  );
});

test("bug comment with all fields", () => {
  assert.equal(
    bugCommentBody(BASE, RUN, finding({})),
    [
      "Bug: Coupon applies two times",
      "Coupon abuser, Abuse lens",
      "",
      "Steps:",
      "1. Open the store.",
      "2. Enter SAVE10. Click Apply.",
      "",
      "Expected: $21.60",
      "Saw: $19.44",
      "Production: $21.60",
      "",
      "![Failure screenshot](https://blob.example/shot.png)",
      "",
      "[Open the paused session](https://pinepoint.example/app?run=run-1&finding=f1). Take control. The cart is still full.",
      "Decide in the session: Bug or Not a bug.",
    ].join("\n"),
  );
});

test("bug comment without production value and screenshot", () => {
  assert.equal(
    bugCommentBody(BASE, RUN, finding({ production_saw: null, screenshot_url: null })),
    [
      "Bug: Coupon applies two times",
      "Coupon abuser, Abuse lens",
      "",
      "Steps:",
      "1. Open the store.",
      "2. Enter SAVE10. Click Apply.",
      "",
      "Expected: $21.60",
      "Saw: $19.44",
      "",
      "[Open the paused session](https://pinepoint.example/app?run=run-1&finding=f1). Take control. The cart is still full.",
      "Decide in the session: Bug or Not a bug.",
    ].join("\n"),
  );
});

test("bugCommentBody makes a /api/shots picture path absolute on the app", () => {
  const body = bugCommentBody(BASE, RUN, finding({ screenshot_url: "/api/shots/0b5e2f9a-0000-4000-8000-000000000001" }));
  assert.match(body, /!\[Failure screenshot\]\(https:\/\/pinepoint\.example\/api\/shots\/0b5e2f9a-0000-4000-8000-000000000001\)/);
});

test("absoluteImageUrl keeps an absolute URL", () => {
  assert.equal(absoluteImageUrl(BASE, "https://cdn.example/a.png"), "https://cdn.example/a.png");
});
