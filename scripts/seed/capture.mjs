// Captures the Plan B screenshots of the demo store (VI-21).
// Run from the repo root: node scripts/seed/capture.mjs
// Set CHROMIUM_PATH to use a different browser binary.

import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "apps", "web", "public", "demo");

const PREVIEW = "https://pinepoint-demo-store-git-feat-free-shipping-vi-s-team.vercel.app";
const PRODUCTION = "https://pinepoint-demo-store.vercel.app";
const MAX_BYTES = 400 * 1024;

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = "/opt/pw-browsers";
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  const path = dir && join(base, dir, "chrome-linux", "chrome");
  if (!path || !existsSync(path)) throw new Error("Chromium not found. Set CHROMIUM_PATH.");
  return path;
}

async function applySave10TwoTimes(page) {
  await page.getByRole("button", { name: "Add Sage linen apron to cart" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Coupon code").fill("SAVE10");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForTimeout(300);
  }
}

async function shot(page, file, expectedTotal, expectedText) {
  if (expectedTotal) {
    const total = (await page.getByTestId("total").innerText()).trim();
    if (total !== expectedTotal) throw new Error(`${file}: total is ${total}, expected ${expectedTotal}`);
    await page.getByTestId("total").scrollIntoViewIfNeeded();
  }
  if (expectedText) await page.getByText(expectedText).first().waitFor({ timeout: 5000 });
  const path = join(outDir, file);
  await page.screenshot({ path });
  const size = statSync(path).size;
  if (size > MAX_BYTES) throw new Error(`${file} is ${size} bytes, over ${MAX_BYTES}`);
  console.log(`${file}: ${size} bytes`);
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  let page = await context.newPage();
  await page.goto(PREVIEW, { waitUntil: "networkidle" });
  await shot(page, "store-home.png");
  await applySave10TwoTimes(page);
  await shot(page, "coupon-bug.png", "$19.44");
  await page.close();

  page = await context.newPage();
  await page.goto(PRODUCTION, { waitUntil: "networkidle" });
  await applySave10TwoTimes(page);
  await shot(page, "coupon-production.png", "$21.60", "Coupon already applied.");
} finally {
  await browser.close();
}
