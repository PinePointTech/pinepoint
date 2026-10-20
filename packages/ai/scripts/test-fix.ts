// Acceptance check for VI-16: pnpm --filter ai test:fix -- --finding FINDING_ID [--force] [--dry-run] [--planted] [--json]
//
// Runs the fix agent on one Bug finding, prints the fix, and checks:
//   1. The agent returned a fix (not the null form).
//   2. The line range is inside the diff, on the right side, in one hunk.
//   3. The explanation is STE: 3 sentences or fewer, no semicolons, 20 words or fewer per sentence.
//   4. With --planted: the fix puts back the "already applied" check of the coupon bug.
//
//   --force     build a new fix also when the finding has one
//   --dry-run   build and validate, but write nothing
//   --json      print the fix as JSON only, for piping
// Needs DATABASE_URL, GITHUB_TOKEN, ANTHROPIC_API_KEY and FIX_MODEL from .env.local.
// Posting the suggestion is checked by hand on the PR: the comment shows "Commit suggestion".

import { parseArgs } from "node:util";
import { octokit } from "@pinepoint/github";
import { getPrDiff } from "@pinepoint/github/context";
import { fixFinding, isInsideHunk, loadFindingWithRun, rightSideHunkLines, validateFix, type StoredFix } from "../src/index";

const { values } = parseArgs({
  // pnpm passes the "--" separator through.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    finding: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    planted: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

if (!values.finding) {
  console.error("Usage: pnpm --filter ai test:fix -- --finding FINDING_ID [--force] [--dry-run] [--planted] [--json]");
  process.exit(2);
}

const log = (...parts: unknown[]) => {
  if (!values.json) console.log(...parts);
};

const started = Date.now();
const attempts: string[] = [];
const result = await fixFinding(values.finding, {
  // The script works on legacy demo findings, so the shared token is the right client here.
  gh: octokit(),
  force: values.force,
  dryRun: values["dry-run"],
  onAttempt: ({ attempt, error }) => attempts.push(error ? `attempt ${attempt}: did not validate\n${error}` : `attempt ${attempt}: valid`),
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const stored: StoredFix = result.stored;

// A reused fix has no diff in the result. Read the diff from GitHub to check the range.
let diff = result.diff;
if (diff === null) {
  const finding = await loadFindingWithRun(values.finding);
  if (!finding) throw new Error(`Finding ${values.finding} does not exist.`);
  diff = await getPrDiff(octokit(), { owner: finding.owner, repo: finding.repo, number: finding.pr_number });
}

if (values.json) {
  console.log(JSON.stringify({ ...stored, reused: result.reused, usage: result.usage }, null, 2));
} else {
  const source = result.reused ? "already in the database" : values["dry-run"] ? "built, not written" : "built and written";
  console.log(`finding:  ${values.finding}`);
  console.log(`fix:      ${source} in ${seconds}s`);
  console.log(`model:    ${stored.model}, ${stored.attempts} attempt(s)`);
  console.log(`tokens:   ${result.usage.inputTokens} in, ${result.usage.outputTokens} out`);
  for (const a of attempts) console.log(`          ${a.replace(/\n/g, "\n          ")}`);
  console.log("");
  if (stored.fix) {
    const f = stored.fix;
    console.log(`${f.path}:${f.startLine}-${f.endLine} (confidence ${f.confidence})`);
    console.log("--- replacement ---");
    console.log(f.replacement);
    console.log("--- explanation ---");
    console.log(f.explanation);
  } else {
    console.log("No fix.");
    console.log(`Reason: ${stored.reason ?? "(none)"}`);
  }
  console.log("");
}

const checks: Array<[string, boolean, string?]> = [];
checks.push(["the agent returned a fix", stored.fix !== null, stored.reason ?? undefined]);

if (stored.fix) {
  const f = stored.fix;
  const lines = rightSideHunkLines(diff);
  checks.push([
    "the line range is inside the diff, on the right side, in one hunk",
    isInsideHunk(lines, f.path, f.startLine, f.endLine),
    `${f.path}:${f.startLine}-${f.endLine}`,
  ]);
  const problems = validateFix(f, diff).filter((p) => p.startsWith("explanation"));
  checks.push(["the explanation is STE in 3 sentences or fewer", problems.length === 0, problems.join("\n  ")]);
  if (values.planted) {
    const text = f.replacement;
    const putsBack = text.includes("Coupon already applied.") || /cart\.coupons\.includes\(code\)/.test(text);
    checks.push(['the fix puts back the "already applied" check', putsBack, "the replacement has neither the message nor cart.coupons.includes(code)"]);
    checks.push(["the fix is in apps/demo-store/lib/cart.ts", f.path === "apps/demo-store/lib/cart.ts", f.path]);
  }
}

let ok = true;
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass && detail) console.log(`  ${detail}`);
  ok &&= pass;
}
process.exit(ok ? 0 : 1);
