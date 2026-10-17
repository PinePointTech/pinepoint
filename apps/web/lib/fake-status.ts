// Fake data for /app. Used with ?fake=1, or when the API routes return 404.
// The fake run tests the planted PR. Its 10 missions move from queued to
// running to end states over about 30 seconds.
import type {
  Finding,
  Mission,
  MissionStatus,
  Run,
  RunsResponse,
  StatusResponse,
} from "./app-types";

export const FAKE_RUN_ID = "00000000-0000-4000-8000-000000000010";
export const FAKE_BUG_FINDING_ID = "00000000-0000-4000-8000-0000000000b1";
export const FAKE_POSSIBLE_FINDING_ID = "00000000-0000-4000-8000-0000000000b2";
const OLD_RUN_IDS = [
  "00000000-0000-4000-8000-000000000009",
  "00000000-0000-4000-8000-000000000008",
];

const PR_URL = "https://github.com/vihuynh72/pinepoint/pull/10";
const PREVIEW_URL = "https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app";

type Plan = {
  lens: string;
  persona: string;
  goal: string;
  end: MissionStatus;
};

const PLANS: Plan[] = [
  { lens: "Flow", persona: "First-time buyer", goal: "Add the Sage linen apron to the cart and place the order.", end: "passed" },
  { lens: "Flow", persona: "Returning buyer", goal: "Buy all three products and read the total.", end: "passed" },
  { lens: "Abuse", persona: "Coupon abuser", goal: "Apply SAVE10 two times and read the total.", end: "failed" },
  { lens: "Abuse", persona: "Code guesser", goal: "Apply the code WELCOME and read the message.", end: "passed" },
  { lens: "UI", persona: "Careful reader", goal: "Apply FREESHIP to the Oat oven glove and read the shipping line.", end: "failed" },
  { lens: "UI", persona: "Phone shopper", goal: "Use the store on a narrow screen and place an order.", end: "passed" },
  { lens: "Access", persona: "Keyboard user", goal: "Add a product and apply SAVE10 with the keyboard only.", end: "passed" },
  { lens: "Access", persona: "Screen reader user", goal: "Apply SAVE10 and read the coupon message.", end: "passed" },
  { lens: "Safety", persona: "Cautious buyer", goal: "Place an order and check that the store asks for no payment data.", end: "passed" },
  { lens: "Flow", persona: "Cart editor", goal: "Remove the Oat oven glove and read the new total.", end: "passed" },
];

const BUG_INDEX = 2;
const POSSIBLE_INDEX = 4;

function missionId(i: number): string {
  return `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
}

// Seconds after the run start.
const startAt = (i: number) => 2 + i * 1.5;
const endAt = (i: number) => 12 + i * 1.8;
const LAST_END = endAt(PLANS.length - 1);
const DONE_AT = LAST_END + 2;

let clockStart: number | null = null;

// Restart the fake clock. POST /api/runs in fake mode calls this.
export function resetFakeClock(): void {
  clockStart = Date.now();
}

function elapsedSeconds(): number {
  if (clockStart === null) clockStart = Date.now();
  return (Date.now() - clockStart) / 1000;
}

function iso(baseMs: number, seconds: number): string {
  return new Date(baseMs + seconds * 1000).toISOString();
}

function buildStatus(runId: string, t: number, baseMs: number): StatusResponse {
  const missions: Mission[] = PLANS.map((p, i) => {
    let status: MissionStatus = "queued";
    if (t >= endAt(i)) status = p.end;
    else if (t >= startAt(i)) status = "running";
    return {
      id: missionId(i),
      run_id: runId,
      kind: "preview",
      parent_id: null,
      lens: p.lens,
      persona: p.persona,
      goal: p.goal,
      checks: null,
      target_path: null,
      target_line: null,
      new_feature: i === BUG_INDEX,
      url: PREVIEW_URL,
      status,
      result: null,
      screenshot_url:
        t >= endAt(i) && i === BUG_INDEX
          ? "/demo/coupon-bug.png"
          : t >= startAt(i)
            ? "/demo/store-home.png"
            : null,
      usage: null,
      started_at: t >= startAt(i) ? iso(baseMs, startAt(i)) : null,
      finished_at: t >= endAt(i) ? iso(baseMs, endAt(i)) : null,
    };
  });

  const findings: Finding[] = [];
  const base = {
    run_id: runId,
    production_saw: null,
    screenshot_url: null,
    comment_id: null,
    decision: null,
    decided_at: null,
    fix: null,
    fix_comment_id: null,
    rerun_status: null,
  };
  if (t >= endAt(BUG_INDEX)) {
    findings.push({
      ...base,
      id: FAKE_BUG_FINDING_ID,
      mission_ids: [missionId(BUG_INDEX)],
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
      screenshot_url: "/demo/coupon-bug.png",
      path: "apps/demo-store/lib/cart.ts",
      line: 38,
    });
  }
  if (t >= endAt(POSSIBLE_INDEX)) {
    findings.push({
      ...base,
      id: FAKE_POSSIBLE_FINDING_ID,
      mission_ids: [missionId(POSSIBLE_INDEX)],
      level: "possible",
      title: "The shipping line does not name FREESHIP",
      steps: [
        "Open the store.",
        "Add the Oat oven glove to the cart.",
        "Enter FREESHIP. Click Apply.",
        "Read the Shipping line.",
      ],
      expected: "Shipping: Free (FREESHIP)",
      saw: "Shipping: Free",
      path: "apps/demo-store/lib/cart.ts",
      line: 66,
    });
  }

  const ended = missions.filter((m) => m.finished_at !== null).length;
  let status: Run["status"] = "planning";
  if (t >= DONE_AT) status = "done";
  else if (t >= LAST_END) status = "reporting";
  else if (t >= startAt(0)) status = "running";

  const run: Run = {
    id: runId,
    pr_url: PR_URL,
    owner: "vihuynh72",
    repo: "pinepoint",
    pr_number: 10,
    head_sha: "efb48a1",
    author: "vihuynh72",
    preview_url: PREVIEW_URL,
    production_url: null,
    status,
    review_id: null,
    review_posted_at: null,
    cost_usd: Math.round(ended * 0.042 * 100) / 100,
    started_at: iso(baseMs, 0),
    finished_at: status === "done" ? iso(baseMs, DONE_AT) : null,
  };

  return { run, missions, findings };
}

// The main fake run animates. Older fake runs are always done.
// Set opts.complete to skip the animation (for a shared ?finding= link).
export function getFakeStatus(
  runId: string,
  opts: { complete?: boolean } = {},
): StatusResponse {
  if (runId === FAKE_RUN_ID && !opts.complete) {
    const t = elapsedSeconds();
    return buildStatus(runId, t, Date.now() - t * 1000);
  }
  const idx = OLD_RUN_IDS.indexOf(runId);
  const baseMs = Date.now() - (idx + 1) * 3600 * 1000;
  return buildStatus(runId, DONE_AT + 1, baseMs);
}

export function getFakeRuns(): RunsResponse {
  const ids = [FAKE_RUN_ID, ...OLD_RUN_IDS];
  return {
    runs: ids.map((id) => getFakeStatus(id, { complete: true }).run),
  };
}
