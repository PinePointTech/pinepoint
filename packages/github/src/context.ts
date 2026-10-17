// getPrContext(prUrl): all that the planner and the runner need from one PR (plan section 7).
//
// TODO VI-11 (Vi): this file is a temporary stand-in so that VI-10 can run end to end.
// What it does today:
//   - owner, repo, number from the URL; head SHA and author from the PR.
//   - the diff, the changed files and qa.md, live from GitHub when GITHUB_TOKEN is set,
//     or from the saved fixture in packages/ai/fixtures when it is not.
//   - previewUrl from `overrides.previewUrl` (the request body), then DEMO_PREVIEW_URL, then null.
// What VI-11 adds: the deployments lookup for the head SHA (environment name contains
// VERCEL_DEMO_PROJECT_NAME, latest status with state success, environment_url).
// Keep the signature. POST /api/runs imports this by subpath: "@pinepoint/github/context".

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { octokit, parsePrUrl, type PrRef } from "./client";

export interface PrChangedFile {
  path: string;
  /** The full file at the head SHA. Missing for a deleted or binary file. */
  content?: string;
}

export interface PrContext extends PrRef {
  prUrl: string;
  headSha: string | null;
  author: string | null;
  /** Unified diff (Accept: application/vnd.github.v3.diff). */
  diff: string;
  changedFiles: PrChangedFile[];
  /** The Vercel preview of the head SHA, or null when no successful deployment exists. */
  previewUrl: string | null;
  /** apps/demo-store/qa.md at the head SHA. */
  qaMd: string;
}

export interface PrContextOverrides {
  previewUrl?: string | null;
}

export const QA_MD_PATH = "apps/demo-store/qa.md";
const MAX_CHANGED_FILES = 20;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

function fixturePath(ref: PrRef): string {
  return join(repoRoot, "packages/ai/fixtures", `${ref.owner}-${ref.repo}-pr-${ref.number}.diff`);
}

/** Paths that have a right side in the diff, in diff order. Mirrors @pinepoint/ai changedPaths without the dependency. */
function pathsInDiff(diff: string): string[] {
  const paths: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).split("\t")[0]!.trim();
      if (target !== "/dev/null") paths.push(target.replace(/^b\//, ""));
    }
  }
  return paths;
}

async function fileAt(ref: PrRef, path: string, sha: string | null): Promise<string | undefined> {
  try {
    const res = await octokit().repos.getContent({ owner: ref.owner, repo: ref.repo, path, ...(sha ? { ref: sha } : {}) });
    const data = res.data as { type?: string; content?: string; encoding?: string };
    if (data.type !== "file" || !data.content) return undefined;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) ?? "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

async function fromGitHub(ref: PrRef): Promise<Omit<PrContext, "previewUrl" | "prUrl" | keyof PrRef>> {
  const gh = octokit();
  const [pr, diffRes] = await Promise.all([
    gh.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number }),
    gh.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      headers: { accept: "application/vnd.github.v3.diff" },
    }),
  ]);
  const headSha = pr.data.head.sha;
  const diff = String(diffRes.data);
  const paths = pathsInDiff(diff).slice(0, MAX_CHANGED_FILES);
  const [qaMd, ...contents] = await Promise.all([fileAt(ref, QA_MD_PATH, headSha), ...paths.map((p) => fileAt(ref, p, headSha))]);
  return {
    headSha,
    author: pr.data.user?.login ?? null,
    diff,
    changedFiles: paths.map((path, i) => (contents[i] === undefined ? { path } : { path, content: contents[i] })),
    qaMd: qaMd ?? "",
  };
}

function fromFixture(ref: PrRef): Omit<PrContext, "previewUrl" | "prUrl" | keyof PrRef> {
  const file = fixturePath(ref);
  if (!existsSync(file)) {
    throw new Error(`GITHUB_TOKEN is not set and no saved diff exists at ${file}.`);
  }
  const diff = readFileSync(file, "utf8");
  const changedFiles = pathsInDiff(diff).map((path) => {
    const full = join(repoRoot, path);
    return existsSync(full) ? { path, content: readFileSync(full, "utf8") } : { path };
  });
  const qaFile = join(repoRoot, QA_MD_PATH);
  return {
    headSha: null,
    author: null,
    diff,
    changedFiles,
    qaMd: existsSync(qaFile) ? readFileSync(qaFile, "utf8") : "",
  };
}

/**
 * Reads one PR. Throws on a URL that is not a GitHub PR URL.
 * `previewUrl` is null when no preview is known; POST /api/runs then stops with status no_preview.
 */
export async function getPrContext(prUrl: string, overrides: PrContextOverrides = {}): Promise<PrContext> {
  const ref = parsePrUrl(prUrl);
  const body = process.env.GITHUB_TOKEN ? await fromGitHub(ref) : fromFixture(ref);
  const previewUrl =
    overrides.previewUrl !== undefined ? overrides.previewUrl : (process.env.DEMO_PREVIEW_URL ?? null);
  return { ...ref, prUrl, previewUrl, ...body };
}
