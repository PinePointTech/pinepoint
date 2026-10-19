// Preview readiness before a run spends compute (docs/github-access-contract.md decision 4; VI-34).
//
// Two questions, answered in order:
//   1. What does GitHub know? deploymentState reads the Deployments API for the PR head and says
//      ready (a success status with a URL), building, failed or missing.
//   2. Can a browser open it? probePreview makes one request. 401/403, or a redirect to Vercel's
//      SSO, is "protected": GitHub access is not Vercel access, and v1 does not bypass protection.
// Every URL that reaches a Computer or this server goes through validateTargetUrl first.

import type { Octokit } from "@octokit/rest";
import { environmentMatches, findVercelCommentPreviewUrl } from "./context";

export type PreviewState = "ready" | "building" | "failed" | "missing" | "protected" | "unreachable" | "unsafe";

export interface PreviewCheck {
  state: PreviewState;
  url: string | null;
  /** One sentence for the person. */
  note: string;
}

// ---------- URL policy ----------

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|metadata\.google\.internal)$/i;

/** True for an IPv4 literal in a private, loopback, link-local or special range. */
export function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export type UrlVerdict = { ok: true; url: string } | { ok: false; reason: string };

/**
 * The outbound-target rule: https only, default port, no credentials, a public host name (no IP
 * literal, no local or internal name). Returns the normalized URL without a fragment.
 */
export function validateTargetUrl(raw: string | null | undefined): UrlVerdict {
  if (!raw || !raw.trim()) return { ok: false, reason: "No URL." };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https URLs are allowed." };
  if (url.username || url.password) return { ok: false, reason: "The URL must not carry credentials." };
  if (url.port && url.port !== "443") return { ok: false, reason: "Only the default https port is allowed." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host.includes(":")) return { ok: false, reason: "IPv6 literals are not allowed." };
  if (isPrivateIpv4(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, reason: "IP addresses are not allowed." };
  if (PRIVATE_HOST.test(host) || !host.includes(".")) return { ok: false, reason: "Local and internal hosts are not allowed." };
  url.hash = "";
  return { ok: true, url: url.toString() };
}

// ---------- what GitHub knows ----------

/** The newest matching deployment of a SHA and its best status. Exported for the tests. */
export async function deploymentState(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
  sha: string,
  projectName: string | null,
): Promise<PreviewCheck> {
  const { data: deployments } = await gh.repos.listDeployments({ owner: ref.owner, repo: ref.repo, sha, per_page: 100 });
  const matches = deployments
    .filter((d) => environmentMatches(d.environment, projectName))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = matches[0];
  if (!newest) {
    // The Vercel GitHub app may post a commit status and a PR comment instead of a deployment.
    const fromComment = await findVercelCommentPreviewUrl(gh, ref, sha, projectName).catch(() => null);
    return fromComment
      ? { state: "ready", url: fromComment, note: "A Vercel preview exists for this commit." }
      : { state: "missing", url: null, note: "No Vercel deployment exists for this commit yet." };
  }
  const { data: statuses } = await gh.repos.listDeploymentStatuses({ owner: ref.owner, repo: ref.repo, deployment_id: newest.id, per_page: 100 });
  const success = statuses.find((s) => s.state === "success");
  if (success) {
    const url = success.environment_url || (success.target_url && /^https:\/\/[^/]+\.vercel\.app(\/|$)/.test(success.target_url) ? success.target_url : null);
    return url
      ? { state: "ready", url, note: "The preview deployed for this commit." }
      : { state: "failed", url: null, note: "The deployment succeeded but reported no URL." };
  }
  if (statuses.some((s) => s.state === "failure" || s.state === "error")) {
    return { state: "failed", url: null, note: "The preview deployment failed for this commit." };
  }
  return { state: "building", url: null, note: "The preview is still building. Try again in a minute." };
}

// ---------- can a browser open it ----------

/** The signs of Vercel Deployment Protection in a response. Pure, for the tests. */
export function looksProtected(status: number, headers: { get(name: string): string | null }): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400) {
    const location = headers.get("location") ?? "";
    if (/vercel\.com\/(sso-api|login)|_vercel\/|vercel\.app\/api\/auth/i.test(location)) return true;
  }
  return headers.get("x-vercel-protection") !== null || (headers.get("set-cookie") ?? "").includes("_vercel_sso_nonce");
}

/** Maps a response to a readiness state. Pure. */
export function readinessFromResponse(status: number, headers: { get(name: string): string | null }): PreviewState {
  if (looksProtected(status, headers)) return "protected";
  if (status >= 200 && status < 400) return "ready";
  if (status === 404 || status === 410) return "missing";
  return "failed";
}

/**
 * One GET with a short timeout and no automatic redirects, as a browser would arrive. The body is
 * not read. Never throws: a network error is "unreachable".
 */
export async function probePreview(url: string, fetchFn: typeof fetch = fetch): Promise<PreviewCheck> {
  const verdict = validateTargetUrl(url);
  if (!verdict.ok) return { state: "unsafe", url: null, note: verdict.reason };
  try {
    const res = await fetchFn(verdict.url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "pinepoint-preflight", accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    const state = readinessFromResponse(res.status, res.headers);
    const notes: Record<PreviewState, string> = {
      ready: "The preview answers.",
      protected: "The preview is behind Vercel Deployment Protection. PinePoint cannot open it. Ask a project owner to allow this preview, or test an unprotected one.",
      missing: `The preview answered ${res.status}.`,
      failed: `The preview answered ${res.status}.`,
      building: "",
      unreachable: "",
      unsafe: "",
    };
    return { state, url: verdict.url, note: notes[state] };
  } catch {
    return { state: "unreachable", url: verdict.url, note: "The preview did not answer." };
  }
}

/** The deployment state, then the probe when there is a URL. The first non-ready answer wins. */
export async function checkPreview(
  gh: Octokit,
  ref: { owner: string; repo: string; number: number },
  sha: string,
  projectName: string | null,
  overrideUrl: string | null = null,
  fetchFn: typeof fetch = fetch,
): Promise<PreviewCheck> {
  const known = overrideUrl
    ? ({ state: "ready", url: overrideUrl, note: "A preview URL was given." } as PreviewCheck)
    : await deploymentState(gh, ref, sha, projectName);
  if (known.state !== "ready" || !known.url) return known;
  return probePreview(known.url, fetchFn);
}
