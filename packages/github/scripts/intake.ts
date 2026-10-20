// Usage: pnpm --filter @pinepoint/github test:intake -- <PR URL>
// Reads the PR with getPrContext and prints a summary and the VI-11 acceptance checks.

import { octokit } from "../src/client";
import { getPrContext } from "../src/context";

const url = process.argv.slice(2).find((a) => a !== "--");
if (!url) {
  console.error("Usage: pnpm --filter @pinepoint/github test:intake -- <PR URL>");
  process.exit(2);
}

// A script for the legacy demo repository, so the shared token and the demo configuration apply.
const ctx = await getPrContext(url, octokit());

console.log(`title:         ${ctx.title}`);
console.log(`headSha:       ${ctx.headSha}`);
console.log(`author:        ${ctx.author}`);
console.log(`previewUrl:    ${ctx.previewUrl ?? "null"}`);
console.log(`productionUrl: ${ctx.productionUrl ?? "null"}`);
console.log(`changed files: ${ctx.changedFiles.length}`);
for (const f of ctx.changedFiles) {
  const content = f.content === undefined ? "no content" : `${f.content.length} chars`;
  console.log(`  ${f.status.padEnd(9)} ${f.path} (+${f.additions} -${f.deletions}, ${content})`);
}
console.log(`diff:          ${ctx.diff ? ctx.diff.split("\n").length : 0} lines`);
console.log(`qa.md:         ${ctx.qaMd === null ? "null" : ctx.qaMd.split("\n")[0]}`);

const checks: Array<[string, boolean]> = [
  ["previewUrl is not null", ctx.previewUrl !== null],
  ["diff is not empty", ctx.diff.length > 0],
  ["changed files are not empty", ctx.changedFiles.length > 0],
  ["qaMd is not null", ctx.qaMd !== null],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
