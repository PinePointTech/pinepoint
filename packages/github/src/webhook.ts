// GitHub webhook helpers: the signature check, the path filter, and the SHA-to-PR lookup.
// POST /api/github/webhook in apps/web uses them. Everything except openPrForSha is pure.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Octokit } from "@octokit/rest";

/** The paths that a PR must change to start a run when PINEPOINT_WEBHOOK_PATHS is not set. */
export const DEFAULT_WEBHOOK_PATHS = ["apps/demo-store/"];

/** The pull_request actions that start a run. Drafts are not skipped: the demo PRs are drafts. */
export const PR_ACTIONS: ReadonlySet<string> = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

function hmacHex(secret: string, data: Buffer | string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Constant-time compare of two strings. False when the lengths differ. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The X-Hub-Signature-256 value that GitHub sends for this body: "sha256=" + HMAC SHA-256 hex. */
export function signBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${hmacHex(secret, rawBody)}`;
}

/**
 * True only when a secret is set and the header is the HMAC SHA-256 of the raw body.
 * A missing secret, a missing header or a wrong header gives false.
 */
export function verifySignature(
  secret: string | undefined,
  rawBody: Buffer | string,
  header: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  return safeEqual(header.trim(), signBody(secret, rawBody));
}

/** The token that POST /api/runs/[id]/drive needs. Only the server knows the secret. */
export function driveToken(secret: string, runId: string): string {
  return hmacHex(secret, `pinepoint-drive:${runId}`);
}

export function verifyDriveToken(secret: string | undefined, runId: string, token: string | null | undefined): boolean {
  if (!secret || !token) return false;
  return safeEqual(token.trim(), driveToken(secret, runId));
}

/** PINEPOINT_WEBHOOK_PATHS as a list of prefixes. Comma separated. Empty or unset gives the default. */
export function webhookPaths(raw: string | undefined = process.env.PINEPOINT_WEBHOOK_PATHS): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((p) => p.trim().replace(/^\.?\/+/, ""))
    .filter((p) => p.length > 0);
  return list.length > 0 ? list : [...DEFAULT_WEBHOOK_PATHS];
}

/** True when one of the changed files starts with one of the prefixes. */
export function touchesPaths(files: readonly string[], prefixes: readonly string[]): boolean {
  return files.some((file) => prefixes.some((prefix) => file.startsWith(prefix)));
}

/**
 * True for a deployment environment that is a preview of the demo store. Vercel names the
 * environments "Preview – <project>" and "Production – <project>".
 */
export function isDemoPreviewEnvironment(
  environment: string | null | undefined,
  projectName = process.env.VERCEL_DEMO_PROJECT_NAME ?? "pinepoint-demo-store",
): boolean {
  if (!environment) return false;
  if (/production/i.test(environment)) return false;
  return environment.includes(projectName);
}

/** The changed paths of a PR. Includes the old path of a renamed file. */
export async function listPrPaths(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
): Promise<string[]> {
  const files = await gh.paginate(gh.pulls.listFiles, {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    per_page: 100,
  });
  return files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
}

export type ShaPr =
  | { found: true; number: number; headSha: string }
  | { found: false; reason: string };

/** The open PR whose head is this SHA. A SHA that is only an older commit of an open PR is not a match. */
export async function openPrForSha(
  gh: Octokit,
  ref: { owner: string; repo: string },
  sha: string,
): Promise<ShaPr> {
  const { data } = await gh.repos.listPullRequestsAssociatedWithCommit({
    owner: ref.owner,
    repo: ref.repo,
    commit_sha: sha,
    per_page: 100,
  });
  const open = data.filter((pr) => pr.state === "open");
  if (open.length === 0) return { found: false, reason: `No open PR has commit ${sha.slice(0, 7)}.` };
  const head = open.find((pr) => pr.head.sha === sha);
  if (!head) return { found: false, reason: `Commit ${sha.slice(0, 7)} is not the head of an open PR any more.` };
  return { found: true, number: head.number, headSha: sha };
}
