import { planMissions } from "../../ai/src/index";
import { getPrContext } from "../../github/src/context";
import { createRun } from "../src/create";
import { advanceRun, startRun } from "../src/orchestrate";
const ctx = await getPrContext("https://github.com/vihuynh72/pinepoint/pull/11");
if (!ctx.previewUrl) { console.log("no preview"); process.exit(1); }
const plan = await planMissions({ diff: ctx.diff, qaMd: ctx.qaMd ?? "", changedFiles: ctx.changedFiles.map(f => f.content === undefined ? { path: f.path } : { path: f.path, content: f.content }) });
const runId = await createRun({ prUrl: ctx.url, owner: ctx.owner, repo: ctx.repo, prNumber: ctx.number, headSha: ctx.headSha, author: ctx.author || null, previewUrl: ctx.previewUrl, productionUrl: ctx.productionUrl, qaMd: ctx.qaMd ?? "" }, plan.missions);
console.log("run:", runId, "production:", ctx.productionUrl);
console.log("started:", await startRun(runId));
const t0 = Date.now();
for (let i = 0; i < 140; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const snap = await advanceRun(runId);
  if (!snap) break;
  const c: Record<string, number> = {};
  for (const m of snap.missions) c[`${m.kind}:${m.status}`] = (c[`${m.kind}:${m.status}`] ?? 0) + 1;
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${snap.run.status} ${JSON.stringify(c)}`);
  if (snap.run.status !== "running") break;
}
