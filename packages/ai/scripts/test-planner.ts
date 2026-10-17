// Acceptance check for VI-9: pnpm --filter ai test:planner -- --pr PLANTED_PR_URL
//
// Runs the planner on one PR and checks:
//   1. The planner returns 10 missions.
//   2. At least one Abuse mission checks the total after SAVE10 two times, with the expected text $21.60.
//   3. Each target line is inside the diff, or the target is null.
//
// Where the inputs come from:
//   --pr <url>      a saved diff at fixtures/<owner>-<repo>-pr-<number>.diff when one exists,
//                   else the live diff from GitHub. qa.md and the changed files come from the PR head.
//                   GitHub auth: GITHUB_TOKEN first, then the `gh` CLI. (Issue 07 adds the shared Octokit code.)
//   --diff <file>   that diff. qa.md and the changed files come from this repo's working tree.
//   --qa <file>     qa.md to use instead of the one found.
//   --json          prints the plan as JSON only, for piping.
// Needs ANTHROPIC_API_KEY and PLANNER_MODEL from .env.local.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MISSIONS_PER_RUN } from "@pinepoint/core";
import { changedPaths, isRightSideLine, planMissions, rightSideLines, type ChangedFile } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");

/** Where qa.md may live in a repo, in order of preference. */
const QA_PATHS = ["apps/demo-store/qa.md", "qa.md"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(name);

interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

function parsePrUrl(url: string): PrRef {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

/**
 * One GitHub REST call. Tries GITHUB_TOKEN first. The token in .env.local works only on
 * vihuynh72/pinepoint, so for other repos it falls back to the `gh` CLI, which uses your login.
 * Returns null on 404.
 */
async function github(path: string, accept: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (res.ok) return res.text();
    if (res.status === 404 && !hasGh()) return null;
    // 401, 403 or a 404 on a repo the token cannot see: try gh.
  }
  if (!hasGh()) {
    throw new Error(`GitHub ${path} failed. Set GITHUB_TOKEN for this repo or install and log in to the gh CLI.`);
  }
  try {
    return execFileSync("gh", ["api", "-H", `Accept: ${accept}`, path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? "");
    if (/HTTP 404|Not Found/.test(stderr)) return null;
    throw new Error(`gh api ${path} failed: ${stderr.trim() || (err as Error).message}`);
  }
}

let ghChecked: boolean | undefined;
function hasGh(): boolean {
  if (ghChecked === undefined) {
    try {
      execFileSync("gh", ["--version"], { stdio: "ignore" });
      ghChecked = true;
    } catch {
      ghChecked = false;
    }
  }
  return ghChecked;
}

/** Reads one file at a ref. Returns null when the file is not there. */
async function githubFile(pr: PrRef, path: string, ref: string): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return github(`/repos/${pr.owner}/${pr.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json");
}

interface Inputs {
  diff: string;
  diffSource: string;
  qaMd: string;
  qaSource: string;
  changedFiles: ChangedFile[];
  filesSource: string;
  pr: PrRef | null;
}

async function loadInputs(): Promise<Inputs> {
  const qaOverride = arg("--qa");
  const diffFile = arg("--diff");
  const prUrl = arg("--pr");
  if (!diffFile && !prUrl) {
    throw new Error("Pass --pr <GitHub PR URL> or --diff <file>.");
  }

  // Local mode: --diff, or --pr with a saved fixture. Files come from this working tree.
  const pr = prUrl ? parsePrUrl(prUrl) : null;
  const fixture = pr ? join(packageRoot, "fixtures", `${pr.owner}-${pr.repo}-pr-${pr.number}.diff`) : null;
  const localDiff = diffFile ? resolve(diffFile) : fixture && existsSync(fixture) ? fixture : null;
  if (localDiff) {
    const diff = readFileSync(localDiff, "utf8");
    const qaPath = qaOverride ?? QA_PATHS.map((p) => join(repoRoot, p)).find(existsSync);
    const changedFiles = changedPaths(diff).map((path) => {
      const full = join(repoRoot, path);
      return existsSync(full) ? { path, content: readFileSync(full, "utf8") } : { path };
    });
    return {
      diff,
      diffSource: localDiff,
      qaMd: qaPath ? readFileSync(qaPath, "utf8") : noQaMd(),
      qaSource: qaPath ?? "(none)",
      changedFiles,
      filesSource: "this working tree",
      pr,
    };
  }

  // Live mode: read the PR from GitHub.
  const ref = pr!;
  const prPath = `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const meta = await github(prPath, "application/vnd.github+json");
  if (meta === null) {
    throw new Error(`PR not found: ${prUrl}`);
  }
  const { head } = JSON.parse(meta) as { head: { sha: string; repo: { full_name: string } | null } };
  const headRepo = head.repo ? parseFullName(head.repo.full_name, ref.number) : ref;
  const diff = (await github(prPath, "application/vnd.github.v3.diff")) ?? "";
  if (!diff.trim()) {
    throw new Error(`PR #${ref.number} has an empty diff.`);
  }

  let qaMd: string;
  let qaSource: string;
  if (qaOverride) {
    qaMd = readFileSync(resolve(qaOverride), "utf8");
    qaSource = qaOverride;
  } else {
    let found: { path: string; text: string } | null = null;
    for (const path of QA_PATHS) {
      const text = await githubFile(headRepo, path, head.sha);
      if (text !== null) {
        found = { path, text };
        break;
      }
    }
    qaMd = found?.text ?? noQaMd();
    qaSource = found ? `${headRepo.owner}/${headRepo.repo}:${found.path}@${head.sha.slice(0, 7)}` : "(none in the repo)";
  }

  const changedFiles: ChangedFile[] = [];
  for (const path of changedPaths(diff)) {
    const content = await githubFile(headRepo, path, head.sha);
    changedFiles.push(content === null ? { path } : { path, content });
  }

  return { diff, diffSource: `${prUrl} (live)`, qaMd, qaSource, changedFiles, filesSource: `${headRepo.owner}/${headRepo.repo}@${head.sha.slice(0, 7)}`, pr: ref };
}

function parseFullName(fullName: string, number: number): PrRef {
  const [owner, repo] = fullName.split("/");
  return { owner: owner!, repo: repo!, number };
}

/** What the planner reads when the repo has no qa.md. */
function noQaMd(): string {
  return [
    "# QA notes",
    "",
    "This repository has no qa.md. Plan from the diff and the changed files only.",
    "Use no test data that the diff does not show. Never enter real payment data. Never sign in.",
  ].join("\n");
}

/** True when the PR is the planted PR from eval/planted.json (the one with a bug). */
function isPlantedPr(pr: PrRef | null): boolean {
  if (!pr || pr.owner !== "vihuynh72" || pr.repo !== "pinepoint") return false;
  const file = join(repoRoot, "eval/planted.json");
  if (!existsSync(file)) return false;
  const planted = JSON.parse(readFileSync(file, "utf8")) as Array<{ pr: number; bug: string | null }>;
  return planted.some((p) => p.pr === pr.number && p.bug !== null);
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
  const jsonOnly = flag("--json");
  const log = (...parts: unknown[]) => {
    if (!jsonOnly) console.log(...parts);
  };

  const { diff, diffSource, qaMd, qaSource, changedFiles, filesSource, pr } = await loadInputs();
  const planted = isPlantedPr(pr);

  log(`Diff: ${diffSource}`);
  log(`qa.md: ${qaSource}`);
  log(`Changed files (${filesSource}): ${changedFiles.map((f) => f.path).join(", ") || "(none)"}`);
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

  // Acceptance checks. The SAVE10 check is for the planted PR only (eval/planted.json).
  const lines = rightSideLines(diff);
  const checks: Array<[string, boolean | "skip"]> = [
    [`The planner returns ${MISSIONS_PER_RUN} missions`, result.missions.length === MISSIONS_PER_RUN],
    [
      "An Abuse mission checks the total after SAVE10 two times with $21.60",
      planted ? hasDoubleCouponCheck(result.missions) : "skip",
    ],
    [
      "Each target line is inside the diff, or the target is null",
      result.missions.every((m) => m.target === null || isRightSideLine(lines, m.target.path, m.target.line)),
    ],
    ["At least one mission has a target", result.missions.some((m) => m.target !== null)],
  ];

  let failed = false;
  if (!jsonOnly) console.log("");
  for (const [name, ok] of checks) {
    if (ok === false) failed = true;
    const label = ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
    if (!jsonOnly) console.log(`${label}  ${name}${ok === "skip" ? " (not the planted PR)" : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
