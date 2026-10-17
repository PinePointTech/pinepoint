// Acceptance check for VI-9: pnpm --filter ai test:planner -- --pr PLANTED_PR_URL
//
// Runs the planner on one PR and checks:
//   1. The planner returns 10 missions.
//   2. At least one Abuse mission checks the total after SAVE10 two times, with the expected text $21.60.
//   3. Each target line is inside the diff, or the target is null.
//
// The diff comes from a saved file until issue 07 reads the live diff:
//   --pr <url>      uses fixtures/<owner>-<repo>-pr-<number>.diff
//   --diff <file>   uses that file
//   --qa <file>     qa.md to use. Default: apps/demo-store/qa.md in this repo.
//   --json          prints the plan as JSON only, for piping.
// Needs ANTHROPIC_API_KEY and PLANNER_MODEL from .env.local.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MISSIONS_PER_RUN } from "@pinepoint/core";
import { changedPaths, isRightSideLine, planMissions, rightSideLines, type ChangedFile } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(name);

function parsePrUrl(url: string): { owner: string; repo: string; number: number } {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

function loadDiff(): { diff: string; source: string } {
  const diffFile = arg("--diff");
  if (diffFile) {
    return { diff: readFileSync(resolve(diffFile), "utf8"), source: diffFile };
  }
  const prUrl = arg("--pr");
  if (!prUrl) {
    throw new Error("Pass --pr <GitHub PR URL> or --diff <file>.");
  }
  const pr = parsePrUrl(prUrl);
  const fixture = join(packageRoot, "fixtures", `${pr.owner}-${pr.repo}-pr-${pr.number}.diff`);
  if (!existsSync(fixture)) {
    throw new Error(
      `No saved diff for PR #${pr.number} at ${fixture}. ` +
        "Save one with `gh pr diff <n> > <that path>` or pass --diff <file>. Issue 07 adds the live diff.",
    );
  }
  return { diff: readFileSync(fixture, "utf8"), source: fixture };
}

function loadChangedFiles(diff: string): ChangedFile[] {
  return changedPaths(diff).map((path) => {
    const full = join(repoRoot, path);
    return existsSync(full) ? { path, content: readFileSync(full, "utf8") } : { path };
  });
}

/** Acceptance 2: an Abuse mission that applies SAVE10 two times and expects $21.60. */
function hasDoubleCouponCheck(missions: Awaited<ReturnType<typeof planMissions>>["missions"]): boolean {
  const twice = /\b(two times|twice|again|second|2 times|2x|double)\b/i;
  return missions.some((m) => {
    if (m.lens !== "Abuse") return false;
    const text = [m.goal, ...m.checks.map((c) => c.name)].join(" ");
    return /SAVE10/i.test(text) && twice.test(text) && m.checks.some((c) => c.expected.includes("$21.60"));
  });
}

async function main() {
  const { diff, source } = loadDiff();
  const qaPath = arg("--qa") ?? join(repoRoot, "apps/demo-store/qa.md");
  const qaMd = readFileSync(qaPath, "utf8");
  const changedFiles = loadChangedFiles(diff);
  const jsonOnly = flag("--json");
  const log = (...parts: unknown[]) => {
    if (!jsonOnly) console.log(...parts);
  };

  log(`Diff: ${source}`);
  log(`qa.md: ${qaPath}`);
  log(`Changed files: ${changedFiles.map((f) => f.path).join(", ") || "(none)"}`);
  log(`Model: ${process.env.PLANNER_MODEL ?? "(PLANNER_MODEL not set)"}`);
  log("");

  const started = Date.now();
  const result = await planMissions(
    { diff, qaMd, changedFiles },
    {
      onAttempt: ({ attempt, error }) => {
        log(error ? `Attempt ${attempt}: did not validate\n${error}\n` : `Attempt ${attempt}: valid`);
      },
    },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("");
    result.missions.forEach((m, i) => {
      const target = m.target ? `${m.target.path}:${m.target.line}` : "null";
      console.log(`${String(i + 1).padStart(2)}. [${m.lens}] ${m.persona}${m.newFeature ? " (new feature)" : ""}`);
      console.log(`    Goal: ${m.goal}`);
      for (const c of m.checks) console.log(`    Check: ${c.name} -> "${c.expected}"`);
      console.log(`    Target: ${target}`);
    });
    console.log("");
    if (result.droppedTargets.length > 0) {
      console.log(
        `Set to null (not on the right side of the diff): ${result.droppedTargets
          .map((d) => `#${d.index + 1} ${d.path}:${d.line}`)
          .join(", ")}`,
      );
    }
    console.log(`Attempts: ${result.attempts}. Tokens: ${result.usage.inputTokens} in, ${result.usage.outputTokens} out. Time: ${seconds}s.`);
  }

  // Acceptance checks.
  const lines = rightSideLines(diff);
  const checks: Array<[string, boolean]> = [
    [`The planner returns ${MISSIONS_PER_RUN} missions`, result.missions.length === MISSIONS_PER_RUN],
    ["An Abuse mission checks the total after SAVE10 two times with $21.60", hasDoubleCouponCheck(result.missions)],
    [
      "Each target line is inside the diff, or the target is null",
      result.missions.every((m) => m.target === null || isRightSideLine(lines, m.target.path, m.target.line)),
    ],
    ["At least one mission has a target", result.missions.some((m) => m.target !== null)],
  ];

  let failed = false;
  if (!jsonOnly) console.log("");
  for (const [name, ok] of checks) {
    if (!ok) failed = true;
    if (!jsonOnly) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
