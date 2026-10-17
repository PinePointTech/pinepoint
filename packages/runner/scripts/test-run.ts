// Acceptance check for VI-10: pnpm --filter runner test:run -- --pr PLANTED_PR_URL [--preview URL] [--base URL]
//
// Posts one run, then polls the status route until every mission is in an end state. Checks:
//   1. The run ends in under 6 minutes, with every mission in an end state.
//   2. No status call takes more than 30 seconds.
//   3. Two status calls at the same time do not start one mission two times:
//      every poll sends two requests at once, and the run ends with exactly 10 preview missions.
//
//   --pr <url>        The PR to run. Required.
//   --preview <url>   The preview URL, until VI-11 reads it from GitHub. Default: DEMO_PREVIEW_URL.
//   --base <url>      The app. Default: APP_BASE_URL, then http://localhost:3000.
//   --interval <ms>   Poll interval. Default: 3000.

import { MISSIONS_PER_RUN } from "@pinepoint/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const prUrl = arg("--pr");
if (!prUrl) {
  console.error("Pass --pr <GitHub PR URL>.");
  process.exit(2);
}
const previewUrl = arg("--preview") ?? process.env.DEMO_PREVIEW_URL;
const base = (arg("--base") ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const intervalMs = Number(arg("--interval") ?? 3000);

const RUN_LIMIT_MS = 6 * 60 * 1000;
const STATUS_LIMIT_MS = 30_000;
const END_STATES = new Set(["passed", "failed", "blocked", "needs_you", "error"]);

type Mission = {
  id: string;
  kind: string;
  lens: string | null;
  persona: string | null;
  status: string;
  kept: boolean;
  parent_id: string | null;
  screenshot_url: string | null;
  usage: { cost?: { total?: number | null } } | null;
  result: Record<string, unknown> | null;
};
type Snapshot = { run: { id: string; status: string }; missions: Mission[]; findings: unknown[] };

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const log = (line: string) => console.log(`[${elapsed()}s] ${line}`);

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

async function getStatus(runId: string): Promise<Snapshot> {
  const res = await fetch(`${base}/api/runs/${runId}/status`);
  if (!res.ok) throw new Error(`status ${res.status}: ${await res.text()}`);
  return (await res.json()) as Snapshot;
}

function summarize(missions: Mission[]): string {
  const counts = new Map<string, number>();
  for (const m of missions) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
  return [...counts.entries()]
    .sort()
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function table(missions: Mission[]): string {
  return missions
    .map((m) => {
      const who = `${m.kind.padEnd(10)} ${(m.lens ?? "").padEnd(6)} ${(m.persona ?? "").slice(0, 28).padEnd(28)}`;
      const flags = [m.kept ? "kept" : "", m.screenshot_url ? "shot" : "", m.parent_id ? "child" : ""].filter(Boolean).join(" ");
      return `  ${m.id.slice(0, 8)} ${who} ${m.status.padEnd(9)} ${flags}`;
    })
    .join("\n");
}

async function main() {
  log(`POST ${base}/api/runs  pr=${prUrl}  preview=${previewUrl ?? "(none: expect no_preview)"}`);
  const post = await timed(async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(previewUrl ? { prUrl, previewUrl } : { prUrl }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST /api/runs ${res.status}: ${text}`);
    return JSON.parse(text) as { runId: string; status: string; started?: number };
  });
  log(`run ${post.value.runId} status=${post.value.status} started=${post.value.started ?? 0} (${post.ms} ms)`);
  const runId = post.value.runId;
  if (post.value.status === "no_preview") {
    console.log("PASS  No preview. No test.");
    return;
  }

  let maxStatusMs = 0;
  let lastSummary = "";
  let snapshot: Snapshot | undefined;
  let polls = 0;

  for (;;) {
    // Two calls at the same time: the double-start guard must hold on every poll.
    const [a, b] = await Promise.all([timed(() => getStatus(runId)), timed(() => getStatus(runId))]);
    polls += 2;
    maxStatusMs = Math.max(maxStatusMs, a.ms, b.ms);
    snapshot = a.value.missions.length >= b.value.missions.length ? a.value : b.value;

    const summary = `${snapshot.run.status}: ${summarize(snapshot.missions)} (${snapshot.missions.length} missions, status ${a.ms}/${b.ms} ms)`;
    if (summary !== lastSummary) {
      log(summary);
      lastSummary = summary;
    }

    const allEnded = snapshot.missions.length > 0 && snapshot.missions.every((m) => END_STATES.has(m.status));
    if (allEnded && snapshot.run.status !== "running" && snapshot.run.status !== "reporting") break;
    if (Date.now() - t0 > RUN_LIMIT_MS + 60_000) {
      log("giving up: the run did not end one minute after the limit");
      break;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const totalMs = Date.now() - t0;
  const missions = snapshot!.missions;
  console.log("");
  console.log(table(missions));
  console.log("");

  const cost = missions.reduce((sum, m) => sum + (m.usage?.cost?.total ?? 0), 0);
  const previewCount = missions.filter((m) => m.kind === "preview").length;
  const ids = new Set(missions.map((m) => m.id));
  const kept = missions.filter((m) => m.kept).length;
  log(`run ${snapshot!.run.status}. ${(totalMs / 1000).toFixed(0)} s total, ${polls} status calls, slowest ${maxStatusMs} ms, Pine cost $${cost.toFixed(3)}, kept Computers ${kept}`);

  const checks: Array<[string, boolean]> = [
    ["Every mission is in an end state", missions.every((m) => END_STATES.has(m.status))],
    [`The run ends in under 6 minutes (${(totalMs / 1000).toFixed(0)} s)`, totalMs < RUN_LIMIT_MS],
    [`No status call takes more than 30 seconds (slowest ${maxStatusMs} ms)`, maxStatusMs <= STATUS_LIMIT_MS],
    [`Exactly ${MISSIONS_PER_RUN} preview missions after parallel status calls (${previewCount})`, previewCount === MISSIONS_PER_RUN],
    ["No duplicate mission rows", ids.size === missions.length],
    [`The run is done (${snapshot!.run.status})`, snapshot!.run.status === "done"],
  ];
  let failed = false;
  for (const [name, ok] of checks) {
    if (!ok) failed = true;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
