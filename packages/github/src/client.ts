// Shared Octokit client and PR URL parsing (plan section 7).

import { Octokit } from "@octokit/rest";

/** The client type, for packages that take a client but do not depend on Octokit themselves. */
export type { Octokit };

export type PrRef = { owner: string; repo: string; number: number };

let cached: Octokit | undefined;

/** GITHUB_TOKEN from the env. Throws a clear error when it is missing. */
export function githubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set. Put it in .env.local.");
  }
  return token;
}

/** The shared Octokit client. It is created on first use, so imports never need the env. */
export function octokit(): Octokit {
  if (!cached) {
    cached = new Octokit({ auth: githubToken(), userAgent: "pinepoint" });
  }
  return cached;
}

/** Reads owner, repo and number from https://github.com/{owner}/{repo}/pull/{number}. */
export function parsePrUrl(url: string): PrRef {
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

/** The canonical URL of a PR. */
export function prUrl({ owner, repo, number }: PrRef): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}
