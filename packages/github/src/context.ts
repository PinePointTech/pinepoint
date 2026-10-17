// Read the PR: diff, changed files, preview URL and qa.md (plan section 7).

import type { Octokit } from "@octokit/rest";
import { octokit, parsePrUrl, prUrl } from "./client";

export interface PrChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** The full file at the head SHA. Omitted for removed, binary or over-budget files. */
  content?: string;
}

export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  headSha: string;
  /** The PR author's login. */
  author: string;
  /** The unified diff (Accept: application/vnd.github.v3.diff). */
  diff: string;
  changedFiles: PrChangedFile[];
  /** The Vercel preview URL for the head SHA, or null when no successful deployment exists. */
  previewUrl: string | null;
  productionUrl: string | null;
  /** apps/demo-store/qa.md at the head SHA, or null when it does not exist. */
  qaMd: string | null;
}

export const QA_MD_PATH = "apps/demo-store/qa.md";
/** The total content budget for changed files. */
export const MAX_CONTENT_BYTES = 200 * 1024;

function demoProjectName(): string {
  return process.env.VERCEL_DEMO_PROJECT_NAME ?? "pinepoint-demo-store";
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 404;
}

/** Reads a file at a ref. Returns null on 404 or when the path is not a file. */
export async function readFileAt(
  gh: Octokit,
  ref: { owner: string; repo: string },
  path: string,
  sha: string,
): Promise<Buffer | null> {
  try {
    const { data } = await gh.repos.getContent({ owner: ref.owner, repo: ref.repo, path, ref: sha });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return Buffer.from(data.content, "base64");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * The preview URL for a SHA: the newest deployment whose environment contains the demo
 * project name, then its first status with state "success".
 */
export async function findDeploymentPreviewUrl(
  gh: Octokit,
  ref: { owner: string; repo: string },
  sha: string,
  projectName = demoProjectName(),
): Promise<string | null> {
  const { data: deployments } = await gh.repos.listDeployments({
    owner: ref.owner,
    repo: ref.repo,
    sha,
    per_page: 100,
  });
  const matches = deployments
    .filter((d) => d.environment.includes(projectName))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = matches[0];
  if (!newest) return null;

  const { data: statuses } = await gh.repos.listDeploymentStatuses({
    owner: ref.owner,
    repo: ref.repo,
    deployment_id: newest.id,
    per_page: 100,
  });
  const success = statuses.find((s) => s.state === "success");
  if (!success) return null;
  if (success.environment_url) return success.environment_url;
  if (success.target_url && /^https:\/\/[^/]+\.vercel\.app(\/|$)/.test(success.target_url)) {
    return success.target_url;
  }
  return null;
}

/**
 * Fallback when the Vercel GitHub app does not create deployments: a "success" commit status
 * whose context contains the project name, plus the project's previewUrl in the vercel[bot]
 * PR comment (base64 JSON after "[vc]: #...:").
 */
export async function findVercelCommentPreviewUrl(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
  sha: string,
  projectName = demoProjectName(),
): Promise<string | null> {
  const { data: combined } = await gh.repos.getCombinedStatusForRef({
    owner: ref.owner,
    repo: ref.repo,
    ref: sha,
    per_page: 100,
  });
  const ok = combined.statuses.some((s) => s.context.includes(projectName) && s.state === "success");
  if (!ok) return null;

  const { data: comments } = await gh.issues.listComments({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    per_page: 100,
  });
  for (const c of comments.reverse()) {
    if (c.user?.login !== "vercel[bot]" || !c.body) continue;
    const m = /^\[vc\]: #[^:]*:([A-Za-z0-9+/=]+)/.exec(c.body);
    if (!m) continue;
    try {
      const payload = JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")) as {
        projects?: Array<{ name?: string; previewUrl?: string; nextCommitStatus?: string }>;
      };
      const project = payload.projects?.find((p) => p.name === projectName);
      if (project?.previewUrl && project.nextCommitStatus === "DEPLOYED") {
        return project.previewUrl.startsWith("http") ? project.previewUrl : `https://${project.previewUrl}`;
      }
    } catch {
      // Not a payload we understand.
    }
  }
  return null;
}

/** The preview URL: the Deployments API first, then the Vercel status and PR comment. */
export async function findPreviewUrl(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
  sha: string,
  projectName = demoProjectName(),
): Promise<string | null> {
  return (
    (await findDeploymentPreviewUrl(gh, ref, sha, projectName)) ??
    (await findVercelCommentPreviewUrl(gh, ref, sha, projectName))
  );
}

async function listChangedFiles(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
): Promise<PrChangedFile[]> {
  const files: PrChangedFile[] = [];
  for (let page = 1; ; page++) {
    const { data } = await gh.pulls.listFiles({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
      page,
    });
    for (const f of data) {
      files.push({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions });
    }
    if (data.length < 100) return files;
  }
}

/** Fills `content` for added or modified text files, within MAX_CONTENT_BYTES in total. */
async function fillContent(
  gh: Octokit,
  ref: { owner: string; repo: string },
  files: PrChangedFile[],
  sha: string,
): Promise<void> {
  let budget = MAX_CONTENT_BYTES;
  for (const file of files) {
    if (file.status === "removed") continue;
    const buf = await readFileAt(gh, ref, file.path, sha);
    if (!buf || buf.includes(0) || buf.length > budget) continue;
    budget -= buf.length;
    file.content = buf.toString("utf8");
  }
}

/** Reads all that the planner and the runner need from a PR. */
export async function getPrContext(url: string, gh: Octokit = octokit()): Promise<PrContext> {
  const ref = parsePrUrl(url);
  const { owner, repo, number } = ref;

  const { data: pr } = await gh.pulls.get({ owner, repo, pull_number: number });
  const headSha = pr.head.sha;

  const diffRes = await gh.pulls.get({ owner, repo, pull_number: number, mediaType: { format: "diff" } });
  const diff = diffRes.data as unknown as string;

  const [changedFiles, previewUrl, qaBuf] = await Promise.all([
    listChangedFiles(gh, ref),
    findPreviewUrl(gh, ref, headSha),
    readFileAt(gh, ref, QA_MD_PATH, headSha),
  ]);
  await fillContent(gh, ref, changedFiles, headSha);

  return {
    owner,
    repo,
    number,
    url: prUrl(ref),
    title: pr.title,
    headSha,
    author: pr.user?.login ?? "",
    diff,
    changedFiles,
    previewUrl,
    productionUrl: process.env.DEMO_PRODUCTION_URL ?? null,
    qaMd: qaBuf ? qaBuf.toString("utf8") : null,
  };
}
