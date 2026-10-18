// Acceptance check for VI-12: pnpm --filter ai test:findings -- --run RUN_ID [--force] [--dry-run] [--planted] [--clean]
//
// Builds the findings of one finished run, prints them, and checks:
//   1. Every finding passes the STE lint (title, steps, expected, saw).
//   2. Every screenshot URL answers a HEAD request with 200 and image/png (a public Blob URL).
//   3. With --planted: exactly one bug finding, and it is the coupon ($21.60 expected).
//   4. With --clean: zero bug findings (the false alarm check from plan section 11).
//
//   --force     delete the unposted findings of the run and build them again
//   --dry-run   build and lint, but write nothing
//   --json      print the findings as JSON only, for piping
// Needs DATABASE_URL, ANTHROPIC_API_KEY and PLANNER_MODEL from .env.local.

import { parseArgs } from "node:util";
import type { FindingRow } from "@pinepoint/core";
import { buildFindings, lintFinding, type BuiltFinding } from "../src/index";

const { values } = parseArgs({
  // pnpm passes the "--" separator through.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    run: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    planted: { type: "boolean", default: false },
    clean: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

if (!values.run) {
  console.error("Usage: pnpm --filter ai test:findings -- --run RUN_ID [--force] [--dry-run] [--planted] [--clean] [--json]");
  process.exit(2);
}

const PLANTED_EXPECTED = "$21.60";

interface Shown {
  level: string;
  title: string;
  steps: string[];
  expected: string | null;
  saw: string | null;
  productionSaw: string | null;
  screenshotUrl: string | null;
  path: string | null;
  line: number | null;
  missionIds: string[];
  attempts: number | null;
  lintErrors: string[];
}

function fromRow(row: FindingRow): Shown {
  return {
    level: row.level ?? "?",
    title: row.title ?? "",
    steps: Array.isArray(row.steps) ? row.steps.map(String) : [],
    expected: row.expected,
    saw: row.saw,
    productionSaw: row.production_saw,
    screenshotUrl: row.screenshot_url,
    path: row.path,
    line: row.line,
    missionIds: row.mission_ids ?? [],
    attempts: null,
    lintErrors: lintFinding(row),
  };
}

function fromBuilt(item: BuiltFinding): Shown {
  return {
    level: item.draft.level,
    title: item.text.title,
    steps: item.text.steps,
    expected: item.text.expected,
    saw: item.text.saw,
    productionSaw: item.draft.productionSaw,
    screenshotUrl: item.draft.screenshotUrl,
    path: item.draft.path,
    line: item.draft.line,
    missionIds: item.draft.missionIds,
    attempts: item.attempts,
    lintErrors: item.lintErrors,
  };
}

async function screenshotOk(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (res.status !== 200) return `HEAD ${url} returned ${res.status}`;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/png")) return `HEAD ${url} returned content-type ${type || "(none)"}`;
    return null;
  } catch (err) {
    return `HEAD ${url} failed: ${(err as Error).message}`;
  }
}

const started = Date.now();
const result = await buildFindings(values.run, { force: values.force, dryRun: values["dry-run"] });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const shown: Shown[] = result.reused ? result.findings.map(fromRow) : result.built.map(fromBuilt);
// After an insert, show the stored rows but keep the attempt counts from the build.
if (!result.reused && result.findings.length === shown.length) {
  result.findings.forEach((row, i) => {
    shown[i] = { ...fromRow(row), attempts: shown[i]!.attempts };
  });
}

if (values.json) {
  console.log(JSON.stringify(shown, null, 2));
} else {
  const source = result.reused ? "already in the database" : values["dry-run"] ? "built, not written" : "built and written";
  console.log(`run:       ${values.run}`);
  console.log(`findings:  ${shown.length} (${source}) in ${seconds}s`);
  console.log(`tokens:    ${result.usage.inputTokens} in, ${result.usage.outputTokens} out`);
  for (const [i, f] of shown.entries()) {
    console.log("");
    console.log(`${i + 1}. [${f.level}] ${f.title}`);
    console.log(`   missions:   ${f.missionIds.join(", ") || "(none)"}`);
    console.log(`   target:     ${f.path ?? "(none)"}${f.line !== null ? `:${f.line}` : ""}`);
    for (const [j, step] of f.steps.entries()) console.log(`   step ${j + 1}:     ${step}`);
    console.log(`   expected:   ${f.expected ?? "(null)"}`);
    console.log(`   saw:        ${f.saw ?? "(null)"}`);
    console.log(`   production: ${f.productionSaw ?? "(null)"}`);
    console.log(`   screenshot: ${f.screenshotUrl ?? "(none)"}`);
    console.log(`   rewrite:    ${f.attempts === null ? "stored" : `${f.attempts} attempt(s)`}, lint ${f.lintErrors.length === 0 ? "pass" : "FAIL"}`);
    for (const e of f.lintErrors) console.log(`     - ${e}`);
  }
  console.log("");
}

const checks: Array<[string, boolean, string?]> = [];

const lintFailures = shown.flatMap((f, i) => f.lintErrors.map((e) => `finding ${i + 1}: ${e}`));
checks.push(["every finding passes the STE lint", lintFailures.length === 0, lintFailures.join("\n  ")]);

const urls = shown.map((f) => f.screenshotUrl).filter((u): u is string => u !== null);
const urlProblems = (await Promise.all(urls.map(screenshotOk))).filter((p): p is string => p !== null);
checks.push([`every screenshot URL is public (${urls.length} checked)`, urlProblems.length === 0, urlProblems.join("\n  ")]);

const bugs = shown.filter((f) => f.level === "bug");
if (values.planted) {
  checks.push(["the planted run gives exactly one bug finding", bugs.length === 1, `bugs: ${bugs.length}`]);
  checks.push([
    `the bug is the coupon (expected has ${PLANTED_EXPECTED})`,
    bugs.length === 1 && (bugs[0]!.expected ?? "").includes(PLANTED_EXPECTED),
    bugs[0] ? `expected: ${bugs[0].expected}` : "no bug",
  ]);
}
if (values.clean) {
  checks.push(["the clean run gives zero bug findings", bugs.length === 0, bugs.map((b) => b.title).join("; ")]);
}

let ok = true;
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass && detail) console.log(`  ${detail}`);
  ok &&= pass;
}
process.exit(ok ? 0 : 1);
