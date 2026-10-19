// Posts or prints the PR review for a run (plan section 9.4).
//
//   pnpm --filter @pinepoint/github test:review -- --run RUN_ID [--dry-run]
//   pnpm --filter @pinepoint/github test:review -- --fixture --dry-run
//
// --fixture builds the payload from a built-in sample and never touches the DB or GitHub.

import { parseArgs } from "node:util";
import { octokit, parsePrUrl } from "../src/client";
import {
  buildReviewPayload,
  postReview,
  type FindingRow,
  type ReviewMission,
  type ReviewRun,
} from "../src/review";

const { values } = parseArgs({
  // pnpm passes the "--" separator through.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    run: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    fixture: { type: "boolean", default: false },
  },
});

const FIXTURE_RUN_ID = "00000000-0000-4000-8000-000000000001";

function fixture() {
  const pr = parsePrUrl("https://github.com/vihuynh72/pinepoint/pull/10");
  const run: ReviewRun = {
    id: FIXTURE_RUN_ID,
    owner: pr.owner,
    repo: pr.repo,
    pr_number: pr.number,
    // Head of feat/free-shipping (PR #10).
    head_sha: "efb48a14b4e42bee59c427d1c6e3f737311f35d8",
    author: "vihuynh72",
  };
  const missions: ReviewMission[] = [
    { id: "m1", persona: "Coupon abuser", lens: "Abuse", status: "failed" },
    { id: "m2", persona: "New shopper", lens: "Happy path", status: "passed" },
    { id: "m3", persona: "Mobile shopper", lens: "Mobile", status: "passed" },
    { id: "m4", persona: "Screen reader user", lens: "Accessibility", status: "failed" },
    { id: "m5", persona: "Slow network shopper", lens: "Network", status: "passed" },
    { id: "m6", persona: "Returning shopper", lens: "Regression", status: "passed" },
    { id: "m7", persona: "Bulk buyer", lens: "Edge cases", status: "passed" },
    { id: "m8", persona: "Free shipping hunter", lens: "New feature", status: "passed" },
    { id: "m9", persona: "Impatient shopper", lens: "Speed", status: "blocked" },
    { id: "m10", persona: "Gift buyer", lens: "Copy", status: "failed" },
  ];
  const findings: FindingRow[] = [
    {
      id: "00000000-0000-4000-8000-0000000000f1",
      mission_ids: ["m1"],
      level: "bug",
      title: "Coupon applies two times",
      steps: [
        "Open the store.",
        "Add the Sage linen apron to the cart.",
        "Enter SAVE10. Click Apply.",
        "Enter SAVE10 again. Click Apply.",
      ],
      expected: "$21.60",
      saw: "$19.44",
      production_saw: "$21.60",
      screenshot_url: null,
      // PR #10 removed the "Coupon already applied." check just above this line.
      path: "apps/demo-store/lib/cart.ts",
      line: 38,
    },
    {
      id: "00000000-0000-4000-8000-0000000000f2",
      mission_ids: ["m4"],
      level: "possible",
      title: "The coupon message is not announced to screen readers",
      steps: [],
      expected: null,
      saw: null,
      production_saw: null,
      screenshot_url: null,
      path: null,
      line: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000f3",
      mission_ids: ["m10"],
      level: "possible",
      title: "The free shipping banner does not mention FREESHIP",
      steps: [],
      expected: null,
      saw: null,
      production_saw: null,
      screenshot_url: null,
      path: null,
      line: null,
    },
  ];
  return { run, missions, findings };
}

async function main() {
  if (values.fixture) {
    if (!values["dry-run"]) {
      throw new Error("--fixture only works with --dry-run. It never posts.");
    }
    const { run, missions, findings } = fixture();
    const base = process.env.APP_BASE_URL || "https://pinepoint.example";
    console.log(JSON.stringify(buildReviewPayload(run, missions, findings, base), null, 2));
    return;
  }
  if (!values.run) {
    throw new Error("Usage: test:review -- --run RUN_ID [--dry-run] | --fixture --dry-run");
  }
  // A script for legacy demo runs: the shared token posts. A private run's review goes through the app.
  const result = await postReview(values.run, { dryRun: values["dry-run"], gh: octokit() });
  console.log(JSON.stringify(result, null, 2));
  if (!values["dry-run"] && !result.posted) {
    console.log("Not posted: the review for this run was already posted (review_posted_at is set).");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
