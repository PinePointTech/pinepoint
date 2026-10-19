import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import {
  DEFAULT_WEBHOOK_PATHS,
  driveBaseUrl,
  driveToken,
  isDemoPreviewEnvironment,
  listPrPaths,
  openPrForSha,
  signBody,
  touchesPaths,
  verifyDriveToken,
  verifySignature,
  webhookPaths,
} from "./webhook";

const SECRET = "test-secret";
const BODY = '{"action":"opened","number":7}';

test("signBody matches the GitHub X-Hub-Signature-256 format", () => {
  const expected = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;
  assert.equal(signBody(SECRET, BODY), expected);
  assert.equal(signBody(SECRET, Buffer.from(BODY)), expected);
});

test("verifySignature accepts the right signature for the raw body", () => {
  assert.equal(verifySignature(SECRET, BODY, signBody(SECRET, BODY)), true);
  assert.equal(verifySignature(SECRET, Buffer.from(BODY), signBody(SECRET, BODY)), true);
});

test("verifySignature rejects a wrong secret, a changed body and a bad header", () => {
  assert.equal(verifySignature(SECRET, BODY, signBody("other", BODY)), false);
  assert.equal(verifySignature(SECRET, `${BODY} `, signBody(SECRET, BODY)), false);
  assert.equal(verifySignature(SECRET, BODY, "sha256=abc"), false);
  assert.equal(verifySignature(SECRET, BODY, signBody(SECRET, BODY).replace("sha256=", "sha1=")), false);
});

test("verifySignature rejects when the secret or the header is missing", () => {
  assert.equal(verifySignature(undefined, BODY, signBody(SECRET, BODY)), false);
  assert.equal(verifySignature("", BODY, signBody("", BODY)), false);
  assert.equal(verifySignature(SECRET, BODY, null), false);
  assert.equal(verifySignature(SECRET, BODY, undefined), false);
  assert.equal(verifySignature(SECRET, BODY, ""), false);
});

test("driveToken is per run and needs the secret", () => {
  const runId = "6f1c2c1e-1111-4222-8333-944455556666";
  const token = driveToken(SECRET, runId);
  assert.equal(verifyDriveToken(SECRET, runId, token), true);
  assert.equal(verifyDriveToken(SECRET, "6f1c2c1e-1111-4222-8333-000000000000", token), false);
  assert.equal(verifyDriveToken("other", runId, token), false);
  assert.equal(verifyDriveToken(undefined, runId, token), false);
  assert.equal(verifyDriveToken(SECRET, runId, null), false);
});

test("webhookPaths defaults to apps/demo-store/", () => {
  assert.deepEqual(webhookPaths(undefined), DEFAULT_WEBHOOK_PATHS);
  assert.deepEqual(webhookPaths(""), ["apps/demo-store/"]);
  assert.deepEqual(webhookPaths(" , "), ["apps/demo-store/"]);
});

test("webhookPaths splits on commas and trims spaces and leading slashes", () => {
  assert.deepEqual(webhookPaths("apps/demo-store/, /packages/ui/ ,./docs/"), [
    "apps/demo-store/",
    "packages/ui/",
    "docs/",
  ]);
});

test("touchesPaths matches a file under a prefix", () => {
  const prefixes = ["apps/demo-store/"];
  assert.equal(touchesPaths(["apps/demo-store/app/cart/page.tsx"], prefixes), true);
  assert.equal(touchesPaths(["README.md", "apps/demo-store/qa.md"], prefixes), true);
});

test("touchesPaths skips app code PRs and look-alike paths", () => {
  const prefixes = ["apps/demo-store/"];
  assert.equal(touchesPaths(["apps/web/app/api/runs/route.ts", "packages/runner/src/pine.ts"], prefixes), false);
  assert.equal(touchesPaths(["apps/demo-store-old/page.tsx"], prefixes), false);
  assert.equal(touchesPaths([], prefixes), false);
});

test("touchesPaths takes any of several prefixes", () => {
  assert.equal(touchesPaths(["docs/qa.md"], ["apps/demo-store/", "docs/"]), true);
});

test("isDemoPreviewEnvironment takes demo store previews only", () => {
  assert.equal(isDemoPreviewEnvironment("Preview – pinepoint-demo-store", "pinepoint-demo-store"), true);
  assert.equal(isDemoPreviewEnvironment("Production – pinepoint-demo-store", "pinepoint-demo-store"), false);
  assert.equal(isDemoPreviewEnvironment("Preview – pinepoint", "pinepoint-demo-store"), false);
  assert.equal(isDemoPreviewEnvironment(undefined, "pinepoint-demo-store"), false);
});

function fakeGh(prs: Array<{ number: number; state: string; head: { sha: string } }>, files: unknown[] = []): Octokit {
  const listFiles = async () => ({ data: files });
  return {
    repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: prs }) },
    pulls: { listFiles },
    paginate: async (fn: unknown) => (fn === listFiles ? files : []),
  } as unknown as Octokit;
}

test("openPrForSha returns the open PR whose head is the SHA", async () => {
  const gh = fakeGh([
    { number: 3, state: "closed", head: { sha: "abc" } },
    { number: 9, state: "open", head: { sha: "abc" } },
  ]);
  assert.deepEqual(await openPrForSha(gh, { owner: "o", repo: "r" }, "abc"), { found: true, number: 9, headSha: "abc" });
});

test("openPrForSha skips a SHA that is not the head any more, or has no open PR", async () => {
  const older = await openPrForSha(fakeGh([{ number: 9, state: "open", head: { sha: "new" } }]), { owner: "o", repo: "r" }, "old");
  assert.equal(older.found, false);
  const none = await openPrForSha(fakeGh([{ number: 3, state: "closed", head: { sha: "abc" } }]), { owner: "o", repo: "r" }, "abc");
  assert.equal(none.found, false);
});

test("driveBaseUrl: production chains to APP_BASE_URL", () => {
  const env = {
    VERCEL_ENV: "production",
    VERCEL_BRANCH_URL: "pinepoint-git-main-team.vercel.app",
    VERCEL_URL: "pinepoint-abc123-team.vercel.app",
    APP_BASE_URL: "https://pinepoint.example/",
  };
  assert.equal(driveBaseUrl(env), "https://pinepoint.example");
  assert.equal(driveBaseUrl({ VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }), null, "no fallback to a deployment URL");
});

test("driveBaseUrl: a preview chains to its own branch URL, then its deployment URL, then APP_BASE_URL", () => {
  const preview = { VERCEL_ENV: "preview", APP_BASE_URL: "https://pinepoint.example" };
  assert.equal(
    driveBaseUrl({ ...preview, VERCEL_BRANCH_URL: "pinepoint-git-fix-team.vercel.app", VERCEL_URL: "pinepoint-abc123-team.vercel.app" }),
    "https://pinepoint-git-fix-team.vercel.app",
  );
  assert.equal(driveBaseUrl({ ...preview, VERCEL_URL: "pinepoint-abc123-team.vercel.app" }), "https://pinepoint-abc123-team.vercel.app");
  assert.equal(driveBaseUrl({ ...preview, VERCEL_BRANCH_URL: " ", VERCEL_URL: "" }), "https://pinepoint.example");
  assert.equal(driveBaseUrl(preview), "https://pinepoint.example");
});

test("driveBaseUrl: local development uses APP_BASE_URL, keeps a protocol, and gives null when nothing is set", () => {
  assert.equal(driveBaseUrl({ APP_BASE_URL: "http://localhost:3000/" }), "http://localhost:3000");
  assert.equal(driveBaseUrl({ VERCEL_ENV: "development", VERCEL_URL: "https://dev.example//" }), "https://dev.example");
  assert.equal(driveBaseUrl({}), null);
});

test("listPrPaths includes the old path of a renamed file", async () => {
  const gh = fakeGh([], [
    { filename: "apps/web/a.ts" },
    { filename: "docs/b.md", previous_filename: "apps/demo-store/b.md" },
  ]);
  assert.deepEqual(await listPrPaths(gh, { owner: "o", repo: "r", number: 1 }), [
    "apps/web/a.ts",
    "docs/b.md",
    "apps/demo-store/b.md",
  ]);
});
