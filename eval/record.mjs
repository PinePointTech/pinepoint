// Appends one run or one interview to eval/results.json.
// Run:       node eval/record.mjs --pr 10 --kind planted --run <runId> --minutes 6.5 --caught yes --bugs 1 --possible 2 --cost 0.84 [--missions 10] [--input-tokens N --output-tokens N] [--started ISO] [--review ISO] [--notes "..."]
// Interview: node eval/record.mjs --interview --who "Name, team" --waiting "..." --last-bug "..." --paused-helps "..." [--notes "..."]
// Add --file path/to/results.json to write another file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KINDS = ["planted", "clean", "real", "dogfood"];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function num(args, key, { required = false, integer = false } = {}) {
  const v = args[key];
  if (v === undefined) {
    if (required) fail(`--${key} is required`);
    return null;
  }
  const n = Number(v);
  if (v === true || !Number.isFinite(n) || n < 0) fail(`--${key} must be a number 0 or more, got "${v}"`);
  if (integer && !Number.isInteger(n)) fail(`--${key} must be a whole number, got "${v}"`);
  return n;
}

function str(args, key, { required = false } = {}) {
  const v = args[key];
  if (v === undefined || v === true) {
    if (required) fail(`--${key} is required`);
    return null;
  }
  return v;
}

function caughtValue(v, kind) {
  if (v === undefined) {
    if (kind === "planted") fail("--caught yes|no is required for a planted run");
    return null;
  }
  if (["yes", "true"].includes(v)) return true;
  if (["no", "false"].includes(v)) return false;
  fail(`--caught must be yes or no, got "${v}"`);
}

function isoOrNull(args, key) {
  const v = str(args, key);
  if (v === null) return null;
  if (Number.isNaN(Date.parse(v))) fail(`--${key} must be a date and time, got "${v}"`);
  return new Date(v).toISOString();
}

const args = parseArgs(process.argv.slice(2));
const file = typeof args.file === "string" ? args.file : join(here, "results.json");
const results = JSON.parse(readFileSync(file, "utf8"));
results.runs ??= [];
results.interviews ??= [];

if (args.interview) {
  const entry = {
    who: str(args, "who", { required: true }),
    prsWaiting: str(args, "waiting", { required: true }),
    lastPreviewBugInProd: str(args, "last-bug", { required: true }),
    pausedSessionHelps: str(args, "paused-helps", { required: true }),
    notes: str(args, "notes") ?? "",
  };
  results.interviews.push(entry);
  writeFileSync(file, JSON.stringify(results, null, 2) + "\n");
  console.log(`Recorded interview ${results.interviews.length}: ${entry.who}`);
} else {
  const kind = str(args, "kind", { required: true });
  if (!KINDS.includes(kind)) fail(`--kind must be one of ${KINDS.join(", ")}, got "${kind}"`);
  const input = num(args, "input-tokens", { integer: true });
  const output = num(args, "output-tokens", { integer: true });
  if ((input === null) !== (output === null)) fail("give both --input-tokens and --output-tokens, or neither");
  const caught = caughtValue(args.caught, kind);
  if (kind !== "planted" && caught !== null) fail("--caught is only for planted runs");

  const entry = {
    pr: num(args, "pr", { required: true, integer: true }),
    kind,
    runId: str(args, "run", { required: true }),
    startedAt: isoOrNull(args, "started"),
    reviewAt: isoOrNull(args, "review"),
    minutesToReview: num(args, "minutes", { required: true }),
    caughtPlantedBug: caught,
    bugFindings: num(args, "bugs", { required: true, integer: true }),
    possibleFindings: num(args, "possible", { required: true, integer: true }),
    missions: num(args, "missions", { integer: true }) ?? 10,
    costUsd: num(args, "cost"),
    tokens: input === null ? null : { input, output },
    notes: str(args, "notes") ?? "",
  };
  if (results.runs.some((r) => r.runId === entry.runId)) fail(`run ${entry.runId} is already recorded`);
  results.runs.push(entry);
  writeFileSync(file, JSON.stringify(results, null, 2) + "\n");
  console.log(`Recorded ${kind} run ${entry.runId} for PR ${entry.pr} (${results.runs.length} runs total)`);
}
