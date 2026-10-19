// Fake data for /app. Used with ?fake=1, or when the API routes return 404.
// The fake run tests the planted PR. It plans for 3 seconds, then its 10 missions move from
// queued to starting (no Computer yet) to testing to end states over about 30 seconds. Pine
// rate limits one start for a few seconds, failures get flake and production re-checks, and
// the findings come during reporting, as in a real run.
import type {
  Finding,
  Mission,
  MissionStatus,
  Run,
  RunsResponse,
  StatusResponse,
  StoredFix,
} from "./app-types";

export const FAKE_RUN_ID = "00000000-0000-4000-8000-000000000010";
export const FAKE_BUG_FINDING_ID = "00000000-0000-4000-8000-0000000000b1";
export const FAKE_POSSIBLE_FINDING_ID = "00000000-0000-4000-8000-0000000000b2";
export const FAKE_OLD_BUG_FINDING_ID = "00000000-0000-4000-8000-0000000000b3";
const OLD_RUN_IDS = [
  "00000000-0000-4000-8000-000000000009",
  "00000000-0000-4000-8000-000000000008",
];

const PR_URL = "https://github.com/vihuynh72/pinepoint/pull/10";
const PREVIEW_URL = "https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app";
const PRODUCTION_URL = "https://pinepoint-demo-store.vercel.app";

type Check = { name: string; expected: string; saw?: string };

type Plan = {
  lens: string;
  persona: string;
  goal: string;
  check: Check;
  end: MissionStatus;
  // The flake and production re-checks of a failure, with their end states.
  followUps?: Array<{ kind: "flake" | "production"; end: MissionStatus }>;
  // Why the runner ended the mission without result.json.
  reason?: string;
  // True when the Computer never started.
  noComputer?: boolean;
};

const PLANS: Plan[] = [
  { lens: "Flow", persona: "First-time buyer", goal: "Add the Sage linen apron to the cart and place the order.", check: { name: "Order confirmation", expected: "Thank you for your order." }, end: "passed" },
  { lens: "Flow", persona: "Returning buyer", goal: "Buy all three products and read the total.", check: { name: "Total for three products", expected: "$54.00" }, end: "passed" },
  {
    lens: "Abuse",
    persona: "Coupon abuser",
    goal: "Apply SAVE10 two times and read the total.",
    check: { name: "Total after the second SAVE10", expected: "$21.60", saw: "$19.44" },
    end: "failed",
    followUps: [
      { kind: "flake", end: "failed" },
      { kind: "production", end: "passed" },
    ],
  },
  { lens: "Abuse", persona: "Code guesser", goal: "Apply the code WELCOME and read the message.", check: { name: "Message for WELCOME", expected: "Coupon not valid." }, end: "passed" },
  {
    lens: "UI",
    persona: "Careful reader",
    goal: "Apply FREESHIP to the Oat oven glove and read the shipping line.",
    check: { name: "Shipping line", expected: "Shipping: Free (FREESHIP)", saw: "Shipping: Free" },
    end: "failed",
    followUps: [{ kind: "flake", end: "failed" }],
  },
  {
    lens: "UI",
    persona: "Phone shopper",
    goal: "Use the store on a narrow screen and place an order.",
    check: { name: "Order confirmation", expected: "Thank you for your order.", saw: "The Place order button did not answer." },
    end: "failed",
    followUps: [{ kind: "flake", end: "passed" }],
  },
  { lens: "Access", persona: "Keyboard user", goal: "Add a product and apply SAVE10 with the keyboard only.", check: { name: "Coupon applied with the keyboard", expected: "SAVE10 applied." }, end: "passed" },
  {
    lens: "Access",
    persona: "Screen reader user",
    goal: "Apply SAVE10 and read the coupon message.",
    check: { name: "Coupon message read aloud", expected: "The screen reader reads Coupon applied.", saw: "The screen reader reads nothing." },
    end: "failed",
    followUps: [
      { kind: "flake", end: "failed" },
      { kind: "production", end: "failed" },
    ],
  },
  {
    lens: "Safety",
    persona: "Cautious buyer",
    goal: "Place an order and check that the store asks for no payment data.",
    check: { name: "No payment fields", expected: "The store asks for no card number." },
    end: "error",
    reason: "Could not start the Computer: Pine did not answer in time.",
    noComputer: true,
  },
  { lens: "Flow", persona: "Cart editor", goal: "Remove the Oat oven glove and read the new total.", check: { name: "Total after the remove", expected: "$24.00" }, end: "passed" },
];

const BUG_INDEX = 2;
const POSSIBLE_INDEX = 4;
const OLD_BUG_INDEX = 7;

// The fix the panel shows after Bug in fake mode (demo script, shot 8).
export const FAKE_COUPON_FIX: StoredFix = {
  fix: {
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
    explanation: "The change removed the check for an applied coupon. The fix puts the check back. SAVE10 applies one time again.",
    confidence: "high",
  },
  reason: null,
  model: "claude-opus-5-5",
  attempts: 1,
  createdAt: "2026-10-17T23:40:00.000Z",
};
export const FAKE_FIX_COMMENT_URL = `${PR_URL}#discussion_r2440000000`;

function missionId(i: number): string {
  return `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
}

function followUpId(i: number, j: number): string {
  return `00000000-0000-4000-8000-0000000002${i}${j}`;
}

// Seconds after the run start. Planning ends at PLANNED; the missions exist from then on.
// The dashboard polls every 3 seconds, so each state lasts long enough for one poll to see it.
const PLANNED = 2.5;
// Five Computers start one after another. Then Pine rate limits the next start for 5 seconds.
const RATE_LIMITED: [number, number] = [7, 12];
const startAt = (i: number) => (i < 5 ? PLANNED + i : RATE_LIMITED[1] + (i - 5));
// A claimed mission waits this long for its Computer.
const COMPUTER_S = 2.5;
const endAt = (i: number) => (PLANS[i]!.noComputer ? startAt(i) + 4 : startAt(i) + 7 + (i % 3));
// A re-check is queued when its parent fails, starts soon after and ends 4 seconds later.
const followStartAt = (i: number, j: number) => endAt(i) + 0.8 + j * 0.6;
const followEndAt = (i: number, j: number) => endAt(i) + 4 + j * 0.6;

const LAST_END = Math.max(
  ...PLANS.flatMap((p, i) => [endAt(i), ...(p.followUps ?? []).map((_, j) => followEndAt(i, j))]),
);
// The findings come during reporting, one second before the run is done.
const FINDINGS_AT = LAST_END + 1;
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

// Real Pine usage of the 10 preview missions of run 68934cf1 (PR #10, 17 Oct 2026):
// [input, cache read, cache write, output, Pine cost in USD]. The sample run shows real numbers.
const SAMPLE_USAGE: Array<[number, number, number, number, number]> = [
  [24, 139787, 22159, 1788, 0.012583068],
  [18, 82172, 18303, 1497, 0.009623028],
  [30, 156252, 19495, 2182, 0.012747828],
  [27, 135878, 19136, 2090, 0.012017952],
  [18, 82675, 18566, 1411, 0.00959016],
  [27, 160431, 22257, 1569, 0.012793284],
  [33, 188840, 22267, 2963, 0.0154869],
  [15, 75819, 21713, 1686, 0.010764996],
  [27, 165210, 23113, 2535, 0.01455582],
  [27, 137161, 19163, 2200, 0.012215244],
];

function sampleUsage(i: number) {
  const [input, cacheRead, cacheWrite, output, cost] = SAMPLE_USAGE[i % SAMPLE_USAGE.length]!;
  return {
    llm: { inputTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: output, totalTokens: input + cacheRead + cacheWrite + output },
    cost: { currency: "USD", total: cost, llm: cost, compute: null },
  };
}

// The step pictures the runner saves in missions.result.step_shots. The titles are Pine's.
function sampleSteps(i: number, startS: number, baseMs: number) {
  const titles =
    i === BUG_INDEX
      ? ["Open the store", "Add the Sage linen apron", "Apply SAVE10", "Apply SAVE10 a second time"]
      : ["Open the store", "Add a product to the cart", "Read the cart"];
  return titles.map((title, k) => ({
    url:
      i === BUG_INDEX && k === titles.length - 1
        ? "/demo/coupon-bug.png"
        : i === OLD_BUG_INDEX && k === titles.length - 1
          ? "/demo/coupon-production.png"
          : "/demo/store-home.png",
    title,
    at: iso(baseMs, startS + 1.5 + k * 2),
  }));
}

function checkResult(check: Check, passed: boolean) {
  return { name: check.name, expected: check.expected, saw: passed ? check.expected : (check.saw ?? ""), passed };
}

// One mission row at time t: queued, then running without a Computer, then running, then ended.
function missionAt(
  base: Pick<Mission, "id" | "run_id" | "kind" | "parent_id" | "lens" | "persona" | "goal" | "new_feature" | "url">,
  plan: Plan,
  end: MissionStatus,
  times: { start: number; end: number; usageIndex: number; shots: number },
  t: number,
  baseMs: number,
  kept: boolean,
): Mission {
  const started = t >= times.start;
  const ended = t >= times.end;
  const computer = !plan.noComputer && t >= times.start + COMPUTER_S;
  let status: MissionStatus = "queued";
  if (ended) status = end;
  else if (started) status = "running";

  let result: Record<string, unknown> | null = null;
  if (ended) {
    result =
      end === "error"
        ? { reason: plan.reason ?? "The agent did not write result.json." }
        : {
            checks: [checkResult(plan.check, end === "passed")],
            steps: ["Open the store.", "Do the task.", "Read the result."],
            step_shots: sampleSteps(times.shots, times.start, baseMs),
          };
  }

  let screenshot: string | null = null;
  if (ended && !plan.noComputer) {
    screenshot =
      times.shots === BUG_INDEX && base.kind === "preview"
        ? "/demo/coupon-bug.png"
        : times.shots === OLD_BUG_INDEX && base.kind === "preview"
          ? "/demo/coupon-production.png"
          : "/demo/store-home.png";
  } else if (computer) {
    screenshot = "/demo/store-home.png";
  }

  return {
    ...base,
    checks: [{ name: plan.check.name, expected: plan.check.expected }],
    target_path: null,
    target_line: null,
    status,
    result,
    screenshot_url: screenshot,
    usage: ended && !plan.noComputer ? sampleUsage(times.usageIndex) : null,
    has_computer: !plan.noComputer && (ended || computer),
    kept: ended && kept,
    started_at: started ? iso(baseMs, times.start) : null,
    finished_at: ended ? iso(baseMs, times.end) : null,
  };
}

function buildStatus(runId: string, t: number, baseMs: number): StatusResponse {
  const missions: Mission[] = [];
  if (t >= PLANNED) {
    PLANS.forEach((p, i) => {
      const flakePassed = p.followUps?.some((f) => f.kind === "flake" && f.end === "passed") ?? false;
      // A failed preview keeps its Computer for the session link. The runner stops it when the
      // flake re-run passes.
      const kept = p.end === "failed" && (!flakePassed || t < followEndAt(i, 0));
      missions.push(
        missionAt(
          {
            id: missionId(i),
            run_id: runId,
            kind: "preview",
            parent_id: null,
            lens: p.lens,
            persona: p.persona,
            goal: p.goal,
            new_feature: i === BUG_INDEX,
            url: PREVIEW_URL,
          },
          p,
          p.end,
          { start: startAt(i), end: endAt(i), usageIndex: i, shots: i },
          t,
          baseMs,
          kept,
        ),
      );
      if (t < endAt(i)) return;
      (p.followUps ?? []).forEach((f, j) => {
        missions.push(
          missionAt(
            {
              id: followUpId(i, j),
              run_id: runId,
              kind: f.kind,
              parent_id: missionId(i),
              lens: p.lens,
              persona: p.persona,
              goal: p.goal,
              new_feature: i === BUG_INDEX,
              url: f.kind === "production" ? PRODUCTION_URL : PREVIEW_URL,
            },
            p,
            f.end,
            { start: followStartAt(i, j), end: followEndAt(i, j), usageIndex: i + j + 1, shots: i },
            t,
            baseMs,
            false,
          ),
        );
      });
    });
  }

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
  if (t >= FINDINGS_AT) {
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
    findings.push({
      ...base,
      id: FAKE_OLD_BUG_FINDING_ID,
      mission_ids: [missionId(OLD_BUG_INDEX)],
      level: "old_bug",
      title: "The screen reader does not read the coupon message",
      steps: [
        "Open the store with a screen reader.",
        "Add a product to the cart.",
        "Enter SAVE10. Click Apply.",
        "Listen for the coupon message.",
      ],
      expected: "The screen reader reads Coupon applied.",
      saw: "The screen reader reads nothing.",
      production_saw: "The screen reader reads nothing.",
      screenshot_url: "/demo/coupon-production.png",
      path: null,
      line: null,
    });
  }

  let status: Run["status"] = "planning";
  if (t >= DONE_AT) status = "done";
  else if (t >= LAST_END) status = "reporting";
  else if (t >= PLANNED) status = "running";

  const run: Run = {
    id: runId,
    pr_url: PR_URL,
    owner: "vihuynh72",
    repo: "pinepoint",
    pr_number: 10,
    head_sha: "efb48a1",
    author: "vihuynh72",
    preview_url: PREVIEW_URL,
    production_url: PRODUCTION_URL,
    status,
    review_id: null,
    review_posted_at: null,
    cost_usd: null,
    started_at: iso(baseMs, 0),
    finished_at: status === "done" ? iso(baseMs, DONE_AT) : null,
    next_start_at: t >= RATE_LIMITED[0] && t < RATE_LIMITED[1] ? iso(baseMs, RATE_LIMITED[1]) : null,
    error: null,
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
