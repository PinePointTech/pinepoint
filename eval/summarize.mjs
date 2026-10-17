// Prints the eval summary from eval/results.json and eval/planted.json.
// Usage: node eval/summarize.mjs [--file path/to/results.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Token price comparison only (not what we paid). USD per 1 million tokens.
// TODO(Vi): confirm the current Claude Opus 5.5 list price before the pitch.
// These numbers are NOT confirmed; the output marks them as unconfirmed until you set confirmed: true.
const OPUS_5_5_LIST_PRICE_PER_MTOK = { input: 5, output: 25, confirmed: false };

const FALSE_ALARM_LIMIT = 0.1; // 1 in 10

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const resultsPath = argValue("--file") ?? join(here, "results.json");
const results = JSON.parse(readFileSync(resultsPath, "utf8"));
const planted = JSON.parse(readFileSync(join(here, "planted.json"), "utf8"));

const runs = results.runs ?? [];
const interviews = results.interviews ?? [];

function median(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

const usd = (n) => `$${n.toFixed(2)}`;
const show = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));

const plantedBug = planted.find((p) => p.bug);
const cleanPr = planted.find((p) => !p.bug);

console.log(`Eval summary (${resultsPath})`);
if (runs.length === 0) {
  console.log("No runs yet.");
} else {
  const plantedRuns = runs.filter((r) => r.kind === "planted");
  const caught = plantedRuns.filter((r) => r.caughtPlantedBug === true).length;
  const bugLabel = plantedBug ? ` "${plantedBug.bug}" (PR ${plantedBug.pr})` : "";
  console.log(`Caught planted bug${bugLabel}: ${caught} of ${plantedRuns.length} planted runs`);

  const cleanRuns = runs.filter((r) => r.kind === "clean");
  const alarms = cleanRuns.reduce((sum, r) => sum + (r.bugFindings ?? 0), 0);
  const cleanMissions = cleanRuns.reduce((sum, r) => sum + (r.missions ?? 0), 0);
  const cleanLabel = cleanPr ? ` (PR ${cleanPr.pr})` : "";
  if (cleanMissions === 0) {
    console.log(`False alarms${cleanLabel}: no clean runs yet`);
  } else {
    const rate = alarms / cleanMissions;
    const verdict = rate <= FALSE_ALARM_LIMIT ? "PASS" : "The pitch must say the real number.";
    console.log(
      `False alarms${cleanLabel}: ${alarms} in ${cleanMissions} missions (${(rate * 100).toFixed(1)}%) ${verdict}`,
    );
  }

  const medMinutes = median(runs.map((r) => r.minutesToReview));
  console.log(`Median minutes to review: ${medMinutes === null ? "-" : medMinutes.toFixed(1)}`);
  const medCost = median(runs.map((r) => r.costUsd));
  console.log(`Median cost per run: ${medCost === null ? "-" : usd(medCost)}`);

  const withTokens = runs.filter((r) => r.tokens && typeof r.tokens.input === "number");
  if (withTokens.length > 0) {
    const p = OPUS_5_5_LIST_PRICE_PER_MTOK;
    const prices = withTokens.map((r) => (r.tokens.input * p.input + (r.tokens.output ?? 0) * p.output) / 1e6);
    const note = p.confirmed ? "" : " (UNCONFIRMED list price, see TODO in summarize.mjs)";
    console.log(
      `Token price comparison: median ${usd(median(prices))} per run at Opus 5.5 list price ` +
        `$${p.input}/$${p.output} per MTok input/output, ${withTokens.length} runs with tokens${note}`,
    );
  }

  const others = runs.filter((r) => r.kind === "real" || r.kind === "dogfood");
  if (others.length > 0) {
    console.log("Real and dogfood runs:");
    for (const r of others) {
      console.log(
        `  ${r.kind} PR ${r.pr} run ${show(r.runId)}: ${show(r.bugFindings)} bug, ${show(r.possibleFindings)} possible, ` +
          `${show(r.minutesToReview)} min, cost ${typeof r.costUsd === "number" ? usd(r.costUsd) : "-"}. ${show(r.notes)}`,
      );
    }
  }
}

console.log(`Interviews: ${interviews.length}`);
for (const i of interviews) {
  console.log(`  ${show(i.who)}`);
  console.log(`    PRs waiting for testing: ${show(i.prsWaiting)}`);
  console.log(`    Last preview bug in production: ${show(i.lastPreviewBugInProd)}`);
  console.log(`    Paused broken session helps: ${show(i.pausedSessionHelps)}`);
  if (i.notes) console.log(`    Notes: ${i.notes}`);
}
