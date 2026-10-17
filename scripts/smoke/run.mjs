#!/usr/bin/env node
// PinePoint smoke check. Prints a PASS/FAIL table, exits 1 on any FAIL.
// Usage: node scripts/smoke/run.mjs [--only web|store|prs]
import { existsSync, readdirSync } from "node:fs";
import { chromium } from "playwright-core";

const REPO = "vihuynh72/pinepoint";
const WEB = "https://pinepoint-rho.vercel.app";
const STORE = "https://pinepoint-demo-store.vercel.app";
const PLANTED_PR = 10;
const CLEAN_PR = 11;
// Vercel branch alias, used when GitHub has no deployment record for the head SHA.
const branchAlias = (ref) =>
  `https://pinepoint-demo-store-git-${ref.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-vi-s-team.vercel.app`;
const PLANTED_FALLBACK = branchAlias("feat/free-shipping");
const OPTIONAL_FLAGS = new Set(["DEMO_PRODUCTION_URL"]);
const APRON = "Add Sage linen apron to cart";
const GLOVE = "Add Oat oven glove to cart";

const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
if (only && !["web", "store", "prs"].includes(only)) {
  console.error("--only must be web, store or prs");
  process.exit(2);
}
const want = (group) => !only || only === group;

const results = [];
function record(group, name, pass, detail = "") {
  results.push({ group, name, pass, detail: String(detail) });
}
async function check(group, name, fn) {
  try {
    const out = await fn();
    const pass = typeof out === "object" ? out.pass : !!out;
    const detail = typeof out === "object" ? out.detail : "";
    record(group, name, pass, detail);
  } catch (err) {
    record(group, name, false, `error: ${err.message.split("\n")[0]}`);
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function gh(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pinepoint-smoke",
  };
  const url = `https://api.github.com${path}`;
  let res;
  if (process.env.GITHUB_TOKEN) {
    res = await fetchWithTimeout(url, {
      headers: { ...headers, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    });
  }
  // A rejected token (401) falls back to an unauthenticated request.
  if (!res || res.status === 401) res = await fetchWithTimeout(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
  return res.json();
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = "/opt/pw-browsers";
  if (existsSync(base)) {
    for (const dir of readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const p = `${base}/${dir}/chrome-linux/chrome`;
      if (existsSync(p)) return p;
    }
  }
  return undefined; // let playwright-core try its own default
}

// --- Browser scenarios -------------------------------------------------------

let browser;
async function getBrowser() {
  if (!browser) browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  return browser;
}

// Runs a cart scenario on a fresh page; returns { total, status }.
async function scenario(baseUrl, items, code, times) {
  const b = await getBrowser();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  try {
    const res = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    if (!res || res.status() !== 200) throw new Error(`HTTP ${res ? res.status() : "none"} at ${baseUrl}`);
    for (const item of items) await page.getByRole("button", { name: item, exact: true }).click();
    for (let i = 0; i < times; i++) {
      await page.getByLabel("Coupon code").fill(code);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.waitForTimeout(300);
    }
    const total = (await page.getByTestId("total").innerText()).trim();
    const status = (await page.getByRole("status").first().innerText().catch(() => "")).trim();
    return { total, status };
  } finally {
    await ctx.close();
  }
}

async function expectScenario(baseUrl, items, code, times, wantTotal, wantStatus) {
  const { total, status } = await scenario(baseUrl, items, code, times);
  const okTotal = total === wantTotal;
  const okStatus = wantStatus == null || status === wantStatus;
  return {
    pass: okTotal && okStatus,
    detail: `total=${total}${wantStatus == null ? "" : ` status="${status}"`}`,
  };
}

// --- Checks ------------------------------------------------------------------

async function webChecks() {
  for (const path of ["/", "/app"]) {
    await check("web", `GET ${path} is 200`, async () => {
      const res = await fetchWithTimeout(WEB + path);
      return { pass: res.status === 200, detail: `status=${res.status}` };
    });
  }
  await check("web", "/api/health ok and env flags", async () => {
    const res = await fetchWithTimeout(`${WEB}/api/health`);
    const body = await res.json();
    const env = body.env ?? {};
    const falseFlags = Object.keys(env).filter((k) => env[k] !== true);
    const badFlags = falseFlags.filter((k) => !OPTIONAL_FLAGS.has(k));
    const pass = res.status === 200 && body.ok === true && Object.keys(env).length > 0 && badFlags.length === 0;
    return {
      pass,
      detail: `ok=${body.ok} false=[${falseFlags.join(",")}] commit=${String(body.commit ?? "").slice(0, 7)}`,
    };
  });
}

async function storeChecks() {
  await check("store", "prod: apron + SAVE10 x2 = $21.60, already applied", () =>
    expectScenario(STORE, [APRON], "SAVE10", 2, "$21.60", "Coupon already applied."));
  await check("store", "prod: oven glove alone = $13.00", () =>
    expectScenario(STORE, [GLOVE], "", 0, "$13.00", null));
  await check("store", "prod: FREESHIP not valid", async () => {
    const { status } = await scenario(STORE, [GLOVE], "FREESHIP", 1);
    return { pass: status === "Coupon not valid.", detail: `status="${status}"` };
  });
}

async function previewUrl(sha, fallback) {
  try {
    const deps = await gh(`/repos/${REPO}/deployments?sha=${sha}&per_page=100`);
    const store = deps.filter((d) => String(d.environment ?? "").includes("pinepoint-demo-store"));
    store.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    for (const d of store) {
      const statuses = await gh(`/repos/${REPO}/deployments/${d.id}/statuses?per_page=100`);
      const ok = statuses.find((s) => s.state === "success" && s.environment_url);
      if (ok) return ok.environment_url.replace(/\/$/, "");
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

async function prState(group, num) {
  let pr;
  await check(group, `PR #${num} open, not merged`, async () => {
    pr = await gh(`/repos/${REPO}/pulls/${num}`);
    return { pass: pr.state === "open" && !pr.merged, detail: `state=${pr.state} merged=${pr.merged}` };
  });
  return pr;
}

async function prChecks() {
  const planted = await prState("prs", PLANTED_PR);
  const plantedUrl = planted ? await previewUrl(planted.head.sha, PLANTED_FALLBACK) : PLANTED_FALLBACK;
  await check("prs", `PR #${PLANTED_PR} preview: apron + SAVE10 x2 = $19.44`, () =>
    expectScenario(plantedUrl, [APRON], "SAVE10", 2, "$19.44", null));
  await check("prs", `PR #${PLANTED_PR} preview: glove + FREESHIP = $9.00`, () =>
    expectScenario(plantedUrl, [GLOVE], "FREESHIP", 1, "$9.00", null));

  const clean = await prState("prs", CLEAN_PR);
  if (clean) {
    const cleanUrl = await previewUrl(clean.head.sha, branchAlias(clean.head.ref));
    await check("prs", `PR #${CLEAN_PR} preview: apron + SAVE10 x2 = $21.60`, () =>
      expectScenario(cleanUrl, [APRON], "SAVE10", 2, "$21.60", "Coupon already applied."));
  } else {
    record("prs", `PR #${CLEAN_PR} preview: apron + SAVE10 x2 = $21.60`, false, "PR not readable");
  }

  await check("prs", "main keeps duplicate-coupon guard in cart.ts", async () => {
    const file = await gh(`/repos/${REPO}/contents/apps/demo-store/lib/cart.ts?ref=main`);
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const pass = text.split("\n").some((l) => l.trim() === "if (cart.coupons.includes(code)) {");
    return { pass, detail: pass ? "guard present" : "guard MISSING" };
  });
}

// --- Main --------------------------------------------------------------------

try {
  if (want("web")) await webChecks();
  if (want("store")) await storeChecks();
  if (want("prs")) await prChecks();
} finally {
  if (browser) await browser.close();
}

const w = Math.max(...results.map((r) => r.name.length), 5);
console.log(`PinePoint smoke ${new Date().toISOString()}`);
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.group.padEnd(5)}  ${r.name.padEnd(w)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
