// Plan B saved run (VI-21). Inserts one finished run for the planted PR #10 so the
// dashboard has a complete run to show if a live run fails during the demo.
//
// Run from the repo root (see scripts/seed/README.md):
//   pnpm --filter @pinepoint/core exec node --env-file-if-exists=../../.env.local --import tsx ../../scripts/seed/saved-run.ts
// Flags:
//   --delete  remove the saved run and exit
//   --print   print the run id and the dashboard link, and change nothing
//
// The ids are fixed, so the script is idempotent: each insert first deletes the old saved run.
// It sets no review_id, review_posted_at or comment_id, because no real GitHub review exists.

import { sql } from "../../packages/core/src/index.ts";

const RUN_ID = "5a7ed000-0000-4000-8000-000000000001";
const missionId = (n: number) => `5a7ed000-0000-4000-8000-1000000000${String(n).padStart(2, "0")}`;
const BUG_FINDING_ID = "5a7ed000-0000-4000-8000-200000000001";
const POSSIBLE_FINDING_ID = "5a7ed000-0000-4000-8000-200000000002";

const PR_URL = "https://github.com/vihuynh72/pinepoint/pull/10";
const HEAD_SHA = "efb48a14b4e42bee59c427d1c6e3f737311f35d8"; // head of feat/free-shipping
const PREVIEW_URL = "https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app";
const PRODUCTION_URL = "https://pinepoint-demo-store.vercel.app";
const CART_PATH = "apps/demo-store/lib/cart.ts";
// Right side of PR #10's diff: `if (!(code in PERCENT_COUPONS) && !SHIPPING_COUPONS.has(code)) {`
// in applyCoupon. The removed "Coupon already applied." guard sat directly below it.
const APPLY_COUPON_LINE = 35;
// totals(): `const freeShipping = cart.coupons.some((code) => SHIPPING_COUPONS.has(code));`
const FREE_SHIPPING_LINE = 66;

type MissionRow = {
  n: number;
  kind: "preview" | "flake" | "production";
  parent?: number;
  lens: "Flow" | "UI" | "Abuse" | "Access" | "Safety";
  persona: string;
  goal: string;
  checks: { name: string; expected: string }[];
  path: string | null;
  line: number | null;
  newFeature: boolean;
  url: string;
  status: "passed" | "failed";
  result: Record<string, unknown>;
  screenshot?: string;
};

function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) throw new Error("APP_BASE_URL is not set. Put the pinepoint-web URL in .env.local.");
  return url.replace(/\/+$/, "");
}

function missions(base: string): MissionRow[] {
  const bugShot = `${base}/demo/coupon-bug.png`;
  const prodShot = `${base}/demo/coupon-production.png`;
  const homeShot = `${base}/demo/store-home.png`;
  const pass = (summary: string) => ({ verdict: "passed", summary });
  return [
    {
      n: 1, kind: "preview", lens: "Flow", persona: "First-time buyer",
      goal: "Add the Sage linen apron to the cart and read the total.",
      checks: [{ name: "Total with one apron", expected: "$24.00" }],
      path: null, line: null, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("The cart shows the apron. The total is $24.00."), screenshot: homeShot,
    },
    {
      n: 2, kind: "preview", lens: "Flow", persona: "Shipping saver",
      goal: "Add the Oat oven glove. Apply FREESHIP. Read the shipping.",
      checks: [{ name: "Shipping after FREESHIP", expected: "Free" }],
      path: CART_PATH, line: FREE_SHIPPING_LINE, newFeature: true, url: PREVIEW_URL, status: "passed",
      result: pass("FREESHIP applied. Shipping is Free."),
    },
    {
      n: 3, kind: "preview", lens: "Flow", persona: "Returning buyer",
      goal: "Add two products. Apply SAVE10. Place the order.",
      checks: [{ name: "Order confirmation", expected: "Order placed" }],
      path: null, line: null, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("The order page shows the confirmation."),
    },
    {
      n: 4, kind: "preview", lens: "UI", persona: "Phone shopper",
      goal: "Open the store on a narrow screen. Apply SAVE10. Read the cart.",
      checks: [{ name: "Applied coupons line", expected: "Applied: SAVE10" }],
      path: null, line: null, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("The cart and coupon form fit the screen."),
    },
    {
      n: 5, kind: "preview", lens: "UI", persona: "Careful reader",
      goal: "Apply SAVE10, then remove the apron. Read the coupon message.",
      checks: [{ name: "Message after the cart is empty", expected: "Your cart is empty." }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PREVIEW_URL, status: "failed",
      result: {
        verdict: "failed",
        summary: "The coupon message stayed after the cart was empty. The rerun did not show it.",
        observed: [{ check: "Message after the cart is empty", expected: "Your cart is empty.", saw: "SAVE10 applied." }],
      },
    },
    {
      n: 6, kind: "preview", lens: "Abuse", persona: "Coupon abuser",
      goal: "Apply SAVE10 two times and read the total.",
      checks: [{ name: "Total after SAVE10 two times", expected: "$21.60" }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PREVIEW_URL, status: "failed",
      result: {
        verdict: "failed",
        summary: "SAVE10 applied two times. The total is $19.44.",
        observed: [{ check: "Total after SAVE10 two times", expected: "$21.60", saw: "$19.44" }],
      },
      screenshot: bugShot,
    },
    {
      n: 7, kind: "preview", lens: "Abuse", persona: "Code guesser",
      goal: "Enter FREESHIP10, then save10 in lower case. Read the messages.",
      checks: [{ name: "Message for an unknown code", expected: "Coupon not valid." }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("FREESHIP10 is not valid. save10 applies as SAVE10."),
    },
    {
      n: 8, kind: "preview", lens: "Access", persona: "Keyboard user",
      goal: "Use only the keyboard to add the apron and apply SAVE10.",
      checks: [{ name: "Total after SAVE10", expected: "$21.60" }],
      path: null, line: null, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("All controls take focus. The total is $21.60."),
    },
    {
      n: 9, kind: "preview", lens: "Access", persona: "Screen reader user",
      goal: "Find the coupon field by its label and apply FREESHIP.",
      checks: [{ name: "Coupon field label", expected: "Coupon code" }],
      path: null, line: null, newFeature: true, url: PREVIEW_URL, status: "passed",
      result: pass("The field has the label Coupon code. FREESHIP applied."),
    },
    {
      n: 10, kind: "preview", lens: "Safety", persona: "Script tester",
      goal: "Enter <b>SAVE10</b> as a coupon code. Read the message.",
      checks: [{ name: "Message for markup in the code", expected: "Coupon not valid." }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("The store shows Coupon not valid. as plain text."),
    },
    // Child missions. The dashboard counts only kind 'preview' as the 10 users.
    {
      n: 11, kind: "flake", parent: 5, lens: "UI", persona: "Careful reader",
      goal: "Apply SAVE10, then remove the apron. Read the coupon message.",
      checks: [{ name: "Message after the cart is empty", expected: "Your cart is empty." }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PREVIEW_URL, status: "passed",
      result: pass("The rerun showed Your cart is empty. The first result is a possible issue."),
    },
    {
      n: 12, kind: "production", parent: 6, lens: "Abuse", persona: "Coupon abuser",
      goal: "Apply SAVE10 two times and read the total.",
      checks: [{ name: "Total after SAVE10 two times", expected: "$21.60" }],
      path: CART_PATH, line: APPLY_COUPON_LINE, newFeature: false, url: PRODUCTION_URL, status: "passed",
      result: pass("Production shows Coupon already applied. The total is $21.60."),
      screenshot: prodShot,
    },
  ];
}

async function deleteRun(): Promise<void> {
  const db = sql();
  // Children first: lessons -> findings -> missions -> runs.
  await db.transaction([
    db`delete from lessons where finding_id in (select id from findings where run_id = ${RUN_ID})`,
    db`delete from findings where run_id = ${RUN_ID}`,
    db`delete from missions where run_id = ${RUN_ID}`,
    db`delete from runs where id = ${RUN_ID}`,
  ]);
}

async function insertRun(base: string): Promise<void> {
  const db = sql();
  const rows = missions(base);
  const bugShot = `${base}/demo/coupon-bug.png`;

  const queries = [
    db`delete from lessons where finding_id in (select id from findings where run_id = ${RUN_ID})`,
    db`delete from findings where run_id = ${RUN_ID}`,
    db`delete from missions where run_id = ${RUN_ID}`,
    db`delete from runs where id = ${RUN_ID}`,
    // cost_usd 0.42 is a FAKE placeholder for the demo, not a measured cost.
    db`insert into runs
         (id, pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url,
          status, cost_usd, started_at, finished_at)
       values
         (${RUN_ID}, ${PR_URL}, 'vihuynh72', 'pinepoint', 10, ${HEAD_SHA}, 'vihuynh72',
          ${PREVIEW_URL}, ${PRODUCTION_URL}, 'done', 0.42,
          now() - interval '9 minutes', now() - interval '2 minutes')`,
    // Parents come before children in the list, so parent_id always exists.
    ...rows.map(
      (m) => db`insert into missions
         (id, run_id, kind, parent_id, lens, persona, goal, checks, target_path, target_line,
          new_feature, url, status, result, screenshot_url, started_at, finished_at)
       values
         (${missionId(m.n)}, ${RUN_ID}, ${m.kind}, ${m.parent ? missionId(m.parent) : null},
          ${m.lens}, ${m.persona}, ${m.goal}, ${JSON.stringify(m.checks)}::jsonb,
          ${m.path}, ${m.line}, ${m.newFeature}, ${m.url}, ${m.status},
          ${JSON.stringify(m.result)}::jsonb, ${m.screenshot ?? null},
          now() - interval '8 minutes', now() - interval '3 minutes')`,
    ),
    db`insert into findings
         (id, run_id, mission_ids, level, title, steps, expected, saw, production_saw,
          screenshot_url, path, line)
       values
         (${BUG_FINDING_ID}, ${RUN_ID}, ${[missionId(6), missionId(12)]}::uuid[], 'bug',
          'Coupon applies two times',
          ${JSON.stringify([
            "Open the store.",
            "Add the Sage linen apron to the cart.",
            "Enter SAVE10. Click Apply.",
            "Enter SAVE10 again. Click Apply.",
          ])}::jsonb,
          ${"$21.60"}, ${"$19.44"}, ${"$21.60"}, ${bugShot}, ${CART_PATH}, ${APPLY_COUPON_LINE})`,
    db`insert into findings
         (id, run_id, mission_ids, level, title, steps, expected, saw, production_saw,
          screenshot_url, path, line)
       values
         (${POSSIBLE_FINDING_ID}, ${RUN_ID}, ${[missionId(5), missionId(11)]}::uuid[], 'possible',
          'Coupon message may stay after the cart is empty',
          ${JSON.stringify([
            "Open the store.",
            "Add the Sage linen apron to the cart.",
            "Enter SAVE10. Click Apply.",
            "Click Remove.",
          ])}::jsonb,
          'Your cart is empty.', 'SAVE10 applied.', null, null, ${CART_PATH}, ${APPLY_COUPON_LINE})`,
  ];

  await db.transaction(queries);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--delete")) {
    await deleteRun();
    console.log(`Deleted saved run ${RUN_ID}.`);
  } else if (args.has("--print")) {
    console.log(`Run id: ${RUN_ID}`);
    console.log(`Dashboard: ${appBaseUrl()}/app?run=${RUN_ID}`);
  } else {
    const base = appBaseUrl();
    await insertRun(base);
    console.log(`Saved run ${RUN_ID} for ${PR_URL}.`);
    console.log(`Dashboard: ${base}/app?run=${RUN_ID}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
