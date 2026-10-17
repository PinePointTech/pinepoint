// VI-7 03 Spike: run one mission on one Pine Computer.
//
// One script creates a Client, reads the project policy, creates an ephemeral
// Computer, creates a session with a browser, runs the plan section 6 goal on a
// URL, waits for the turn, reads result.json and fail.png from the artifacts,
// prints the usage, pauses and resumes the Computer, then stops it.
//
// Run: pnpm --filter @pinepoint/runner spike -- --url https://example.com
// Flags:
//   --url <url>          The page to test. Default: https://example.com
//   --expect <text>      Literal text the agent must see on the page. Default: "Example Domain"
//   --no-plant-fail      Do not add the check that must fail (used to prove fail.png exists)
//   --goal <text>        Replace the default goal
//   --check "Name=text"  Add an exact check (repeatable). Replaces the default checks and the planted one
//   --persona / --lens   Override the persona and lens
//   --allow-login        Let the agent use test credentials named in the goal
//   --probe-limit        While paused, create Computers until the limit to learn if paused counts
//   --skip-pause         Skip the pause and resume step
//   --mission-ms <n>     Mission budget in ms. Default: 240000 (4 minutes, plan section 5 rule 7)

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  CapacityExceededError,
  CreateRateLimitedError,
  type Computer,
  type AgentTurn,
  type Artifact,
  type Session,
} from "@pinesandbox/computer";

// ---------- args and env ----------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outDir = resolve(here, "../.spike-out");

for (const candidate of [resolve(repoRoot, ".env.local"), resolve(repoRoot, ".env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore: shell env wins
    }
  }
}

type Check = { name: string; expected: string };

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1]!;
}

const url = opt("url", "https://example.com");
const expectText = opt("expect", "Example Domain");
const customGoal = opt("goal", "");
const customPersona = opt("persona", "");
const customLens = opt("lens", "");
// --check "Name=expected text" (repeatable). Replaces the default checks.
const customChecks: Check[] = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--check" && process.argv[i + 1]) {
    const raw = process.argv[++i]!;
    const eq = raw.indexOf("=");
    if (eq > 0) customChecks.push({ name: raw.slice(0, eq).trim(), expected: raw.slice(eq + 1).trim() });
  }
}
// --allow-login lets the agent use test credentials. Rule 1 still forbids real payment data.
const allowLogin = flag("allow-login");
const plantFail = !flag("no-plant-fail") && customChecks.length === 0;
const probeLimit = flag("probe-limit");
const skipPause = flag("skip-pause");
const missionBudgetMs = Number(opt("mission-ms", "240000"));

if (!process.env.PINE_SANDBOX_API_KEY || !process.env.PINE_SANDBOX_ENDPOINT) {
  console.error(
    "Missing PINE_SANDBOX_API_KEY or PINE_SANDBOX_ENDPOINT. Put them in .env.local at the repo root.",
  );
  process.exit(2);
}

// ---------- logging ----------

const t0 = Date.now();
function log(step: string, data?: unknown) {
  const sec = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  if (data === undefined) console.log(`[${sec}s] ${step}`);
  else console.log(`[${sec}s] ${step}`, typeof data === "string" ? data : JSON.stringify(data));
}
function redactErr(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    const anyE = e as Error & Record<string, unknown>;
    return {
      name: e.name,
      message: e.message,
      status: anyE.status,
      problemType: anyE.problemType,
      code: anyE.code,
      retryAfterSeconds: anyE.retryAfterSeconds,
    };
  }
  return { error: String(e) };
}

// ---------- mission (plan section 6) ----------

const persona = customPersona || "First-time visitor";
const lens = customLens || "Flow";
const goal = customGoal || `Open the page and read the main heading. Check each item in the check list.`;
const checks: Check[] =
  customChecks.length > 0 ? customChecks : [{ name: "Main heading", expected: expectText }];
if (plantFail) {
  checks.push({
    name: "Planted failing check",
    expected: "PINEPOINT_TEXT_THAT_DOES_NOT_EXIST_7f3a",
  });
}

const qaMd = `# qa.md for the spike

This is a public page. There is no login and no payment.

Test data: none.

Never do: enter real payment data, sign in, follow external links.
`;

function buildGoal(): string {
  const checkLines = checks
    .map((c, i) => `${i + 1}. ${c.name}: expected "${c.expected}"`)
    .join("\n");
  const rule1 = allowLogin
    ? "1. Use only the test credentials in the goal. Do not enter real payment data."
    : "1. Do not sign in. Do not enter real payment data.";
  return `You are a simulated user. Persona: ${persona}. Lens: ${lens}.
Open ${url}.
Goal: ${goal}
Rules:
${rule1}
2. Stop after 12 actions.
3. Check each item in the check list. Write what you see.
4. When a check fails, save a screenshot of the screen as fail.png.
5. If a page blocks you (for example a CAPTCHA or a login wall), stop and ask for help.
6. If something looks wrong and no check covers it, write it in notes.
7. If the browser console shows errors, list them in errors.
Check list:
${checkLines}
At the end, write result.json in this shape:
{"checks":[{"name":"","expected":"","saw":"","passed":true}],"steps":["Open the store."],"errors":[],"notes":[],"blocked":false}
Name result.json and fail.png in your final answer.`;
}

// ---------- result.json shape check (plan section 6) ----------

type MissionResult = {
  checks: { name: string; expected: string; saw: string; passed: boolean }[];
  steps: string[];
  errors: unknown[];
  notes: unknown[];
  blocked: boolean;
};

function shapeErrors(v: unknown): string[] {
  const errs: string[] = [];
  if (typeof v !== "object" || v === null) return ["result is not an object"];
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.checks)) errs.push("checks is not an array");
  else
    r.checks.forEach((c, i) => {
      if (typeof c !== "object" || c === null) return errs.push(`checks[${i}] not an object`);
      const cc = c as Record<string, unknown>;
      for (const k of ["name", "expected", "saw"]) {
        if (typeof cc[k] !== "string") errs.push(`checks[${i}].${k} is not a string`);
      }
      if (typeof cc.passed !== "boolean") errs.push(`checks[${i}].passed is not a boolean`);
    });
  if (!Array.isArray(r.steps)) errs.push("steps is not an array");
  if (!Array.isArray(r.errors)) errs.push("errors is not an array");
  if (!Array.isArray(r.notes)) errs.push("notes is not an array");
  if (typeof r.blocked !== "boolean") errs.push("blocked is not a boolean");
  return errs;
}

// ---------- helpers ----------

const decoder = new TextDecoder();

async function waitForTurn(session: Session, turnId: string, budgetMs: number): Promise<AgentTurn> {
  const deadline = Date.now() + budgetMs;
  let turn: AgentTurn;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) {
      log("mission budget exceeded; canceling turn");
      turn = await session.agent.cancel(turnId);
      return turn;
    }
    turn = await session.agent.wait(turnId, { timeoutMs: Math.min(30_000, left) });
    log("turn state", { state: turn.state, turnId: turn.turnId });
    if (turn.state === "needs_input") {
      log("agent asked a question (would be needs_you)", turn.question);
      // The spike has nobody to answer. Close the question so the Computer can be stopped.
      turn = await session.agent.cancel(turnId);
      return turn;
    }
    if (turn.state !== "running" && turn.state !== "canceling") return turn;
  }
}

function pickArtifact(list: Artifact[], name: string): Artifact | undefined {
  return (
    list.find((a) => a.filename === name) ??
    list.find((a) => a.relativePath.endsWith(name)) ??
    list.find((a) => a.filename.toLowerCase() === name.toLowerCase())
  );
}

async function readWorkdirFile(session: Session, name: string): Promise<Uint8Array | undefined> {
  try {
    const files = await session.listFiles({ pattern: name });
    const hit = files.find((f) => !f.isDir && f.name === name);
    if (!hit) return undefined;
    return await session.readFile(hit.relativePath);
  } catch (e) {
    log(`listFiles/readFile(${name}) failed`, redactErr(e));
    return undefined;
  }
}

// ---------- main ----------

const answers: Record<string, unknown> = {
  url,
  concurrencyLimit: null as number | null,
  lifecyclePolicy: null as unknown,
  pauseEnabled: null as boolean | null,
  pauseError: null as string | null,
  idleTimeoutFallback: null as unknown,
  pausedCountsAgainstLimit: "not probed (pass --probe-limit)",
  failPngExists: null as boolean | null,
  failPngSource: null as string | null,
  resultJsonSource: null as string | null,
  resultJsonShapeOk: null as boolean | null,
  consoleErrorsReported: null as unknown,
  missionMs: null as number | null,
  createToReadyMs: null as number | null,
  createToResultMs: null as number | null,
  pauseMs: null as number | null,
  resumeMs: null as number | null,
  usage: null as unknown,
  terminalReason: null as string | null,
  turnState: null as string | null,
  sdkNameDifferencesFromPlan: [
    "computer.createSession({ name, browser: true }) — the plan says label. Both exist; name is the session id used by adoptSession and delegateDesktop.",
    "session.readArtifact(id) returns Uint8Array; session.openArtifact(id) returns a ReadableStream. Both exist.",
    "agent.wait(turnId, { timeoutMs }) requires timeoutMs; it is not optional.",
    "Turn result lives at turn.result: { terminalReason, summary, artifacts: FileRef[], usage }. Artifacts need session.listArtifacts({ turnId }) to get ids.",
    "Usage is turn.result.usage.{llm:{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens}, duration:{totalMs}, cost:{currency,total,llm,compute}}.",
    "Desktop delegation: computer.delegateDesktop(name, { create }) or session.delegate(). Desktop token: session.desktopToken().",
    "Control: both computer.takeControl(name) / releaseControl(name) and session.takeControl() / releaseControl() exist.",
    "Rate limit errors expose retryAfterSeconds, not retryAfter.",
    "projectPolicy() returns { maxConcurrentComputers: number | null, lifecycle: { maxIdleTimeoutSeconds, maxRuntimeAgeSeconds } | null }.",
    "Client.fromEnv() reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY directly.",
    "createComputer accepts idleTimeoutSeconds (default 300, min 60). Pause/resume/stop take { timeoutMs }.",
  ],
};

const created: Computer[] = [];

async function stopAll() {
  for (const c of created.splice(0)) {
    try {
      const ok = await c.stop({ timeoutMs: 120_000 });
      log(`stop ${c.id}`, { confirmed: ok });
    } catch (e) {
      log(`stop ${c.id} failed; trying kill`, redactErr(e));
      try {
        await c.kill();
      } catch (e2) {
        log(`kill ${c.id} failed`, redactErr(e2));
      }
    }
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const client = Client.fromEnv();
  log("client", String(client));

  // 1. Policy before anything is allocated.
  const policy = await client.projectPolicy();
  answers.concurrencyLimit = policy.maxConcurrentComputers;
  answers.lifecyclePolicy = policy.lifecycle;
  log("projectPolicy", policy);

  // 2. One ephemeral Computer.
  const tCreate = Date.now();
  let computer: Computer;
  try {
    computer = await client.createComputer({
      ephemeral: true,
      idleTimeoutSeconds: 600,
      metadata: { app: "pinepoint", issue: "VI-7", kind: "spike" },
    });
  } catch (e) {
    if (e instanceof CapacityExceededError || e instanceof CreateRateLimitedError) {
      log("create refused by limit", redactErr(e));
    }
    throw e;
  }
  created.push(computer);
  answers.createToReadyMs = Date.now() - tCreate;
  log("createComputer", { id: computer.id, runtimeId: computer.runtimeId, ms: answers.createToReadyMs });

  try {
    log("capabilities", await computer.capabilities());
  } catch (e) {
    log("capabilities failed", redactErr(e));
  }

  // 3. One session with a browser. Save the token: Pine returns it one time only.
  const session = await computer.createSession({ name: "mission", browser: true });
  const sessionToken = session.token;
  log("createSession", { name: session.name, tokenLength: sessionToken.length });

  // qa.md as an attachment the agent reads.
  await session.writeFile("qa.md", qaMd);
  log("writeFile qa.md");

  // 4. Run the goal with the mission id as the idempotency key.
  const missionId = randomUUID();
  const fullGoal = buildGoal();
  const tRun = Date.now();
  let turn = await session.agent.run(fullGoal, {
    idempotencyKey: missionId,
    constraints: { maxWallMs: missionBudgetMs },
  });
  log("agent.run", { turnId: turn.turnId, state: turn.state });

  turn = await waitForTurn(session, turn.turnId, missionBudgetMs);
  const tEnd = Date.now();
  answers.missionMs = tEnd - tRun;
  answers.createToResultMs = tEnd - tCreate;
  answers.turnState = turn.state;
  answers.terminalReason = turn.result?.terminalReason ?? null;
  answers.usage = turn.result?.usage ?? null;
  log("turn ended", {
    state: turn.state,
    terminalReason: turn.result?.terminalReason,
    missionMs: answers.missionMs,
  });
  log("summary", turn.result?.summary ?? "(no result)");
  log("usage", turn.result?.usage ?? null);
  log("result.artifacts (FileRef)", turn.result?.artifacts ?? []);

  // 5. Artifacts: result.json and fail.png.
  let artifacts: Artifact[] = [];
  try {
    artifacts = await session.listArtifacts({ turnId: turn.turnId });
  } catch (e) {
    log("listArtifacts failed", redactErr(e));
  }
  log(
    "listArtifacts",
    artifacts.map((a) => ({ id: a.id, filename: a.filename, relativePath: a.relativePath, size: a.size })),
  );

  let resultBytes: Uint8Array | undefined;
  const resultArt = pickArtifact(artifacts, "result.json");
  if (resultArt) {
    resultBytes = await session.readArtifact(resultArt.id);
    answers.resultJsonSource = "artifact";
  } else {
    resultBytes = await readWorkdirFile(session, "result.json");
    if (resultBytes) answers.resultJsonSource = "workdir";
  }

  let failBytes: Uint8Array | undefined;
  const failArt = pickArtifact(artifacts, "fail.png");
  if (failArt) {
    failBytes = await session.readArtifact(failArt.id);
    answers.failPngSource = "artifact";
  } else {
    failBytes = await readWorkdirFile(session, "fail.png");
    if (failBytes) answers.failPngSource = "workdir";
  }
  answers.failPngExists = Boolean(failBytes && failBytes.byteLength > 0);
  if (failBytes) {
    const p = resolve(outDir, "fail.png");
    writeFileSync(p, failBytes);
    log("fail.png saved", { path: p, bytes: failBytes.byteLength });
  } else {
    log("fail.png not found", { plantFail });
  }

  if (resultBytes) {
    const text = decoder.decode(resultBytes);
    writeFileSync(resolve(outDir, "result.json"), text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      log("result.json is not valid JSON", { head: text.slice(0, 300) });
    }
    if (parsed !== undefined) {
      const errs = shapeErrors(parsed);
      answers.resultJsonShapeOk = errs.length === 0;
      if (errs.length) log("result.json shape errors", errs);
      const r = parsed as MissionResult;
      answers.consoleErrorsReported = r.errors;
      console.log("\n===== result.json =====");
      console.log(JSON.stringify(parsed, null, 2));
      console.log("=======================\n");
    }
  } else {
    answers.resultJsonShapeOk = false;
    log("result.json not found in artifacts or workdir");
  }

  // 6. Pause, read the limit while paused, resume.
  if (!skipPause) {
    const tPause = Date.now();
    let paused = false;
    try {
      await computer.pause({ timeoutMs: 180_000 });
      paused = true;
      answers.pauseEnabled = true;
      answers.pauseMs = Date.now() - tPause;
      log("paused", { status: await computer.status(), ms: answers.pauseMs });
    } catch (e) {
      const err = redactErr(e);
      answers.pauseEnabled = false;
      answers.pauseError = err.message;
      log("pause refused", err);
    }

    if (!paused) {
      // Fallback for the product: keep a failed Computer running with a long idle
      // timeout. Work renews the idle window; reading status does not.
      answers.pausedCountsAgainstLimit = "n/a: pause is not enabled; a kept Computer stays running and counts";
      try {
        const before = await computer.runtimeDetails();
        log("runtimeDetails before setIdleTimeout", {
          state: before.state,
          lifetime: before.lifetime,
          expiresAt: before.expiresAt,
        });
        const target = 3600;
        const after = await computer.setIdleTimeout(target);
        answers.idleTimeoutFallback = {
          requestedSeconds: target,
          appliedSeconds: after.lifetime?.idleTimeoutSeconds ?? null,
          maxIdleTimeoutSeconds: after.lifetime?.maxIdleTimeoutSeconds ?? null,
          maxRuntimeAgeSeconds: after.lifetime?.maxRuntimeAgeSeconds ?? null,
          expiresAt: after.expiresAt ?? null,
          lifetimePresent: Boolean(after.lifetime),
        };
        log("setIdleTimeout", answers.idleTimeoutFallback);
      } catch (e) {
        answers.idleTimeoutFallback = { error: redactErr(e) };
        log("setIdleTimeout failed", redactErr(e));
      }
    }

    const pausedPolicy = paused ? await client.projectPolicy() : null;
    if (pausedPolicy) log("projectPolicy while paused", pausedPolicy);

    if (paused && pausedPolicy && probeLimit) {
      // Create Computers until the limit refuses. If the count that succeeds equals the
      // limit, a paused Computer does not count. If it is limit - 1, it does.
      const limit = pausedPolicy.maxConcurrentComputers;
      const maxTries = Math.min(limit ?? 20, 20);
      const probes: Computer[] = [];
      let refused: Record<string, unknown> | null = null;
      for (let i = 0; i < maxTries + 1; i++) {
        try {
          const c = await client.createComputer({ ephemeral: true, idleTimeoutSeconds: 60 });
          probes.push(c);
          created.push(c);
          log(`probe create #${i + 1} ok`, c.id);
        } catch (e) {
          refused = redactErr(e);
          log(`probe create #${i + 1} refused`, refused);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      const extra = probes.length;
      answers.pausedCountsAgainstLimit =
        limit === null
          ? `no limit reported; created ${extra} extra without refusal`
          : extra >= limit
            ? `no: created ${extra} extra with 1 paused (limit ${limit})`
            : `yes: created ${extra} extra with 1 paused (limit ${limit}); refusal ${JSON.stringify(refused)}`;
      log("probe result", answers.pausedCountsAgainstLimit);
      for (const c of probes) {
        try {
          await c.stop({ timeoutMs: 120_000 });
          const idx = created.indexOf(c);
          if (idx >= 0) created.splice(idx, 1);
        } catch (e) {
          log("probe stop failed", redactErr(e));
        }
      }
    }

    if (paused) {
      const tResume = Date.now();
      await computer.resume({ timeoutMs: 180_000 });
      answers.resumeMs = Date.now() - tResume;
      log("resumed", { status: await computer.status(), ms: answers.resumeMs });
    }

    // Prove the session can be re-adopted from its saved token in a new handle.
    const adopted = computer.adoptSession("mission", sessionToken);
    try {
      const after = await adopted.listArtifacts({ turnId: turn.turnId });
      log("artifacts after resume (adopted session)", after.length);
    } catch (e) {
      log("adopted session read failed", redactErr(e));
    }
  }
}

main()
  .catch((e) => {
    log("spike failed", redactErr(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopAll();
    console.log("\n===== VI-7 answers =====");
    console.log(JSON.stringify(answers, null, 2));
    console.log("========================");
  });
