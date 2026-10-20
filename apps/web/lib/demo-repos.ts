// The public demo repositories (docs/github-access-contract.md section 7). A start without a
// session, and the shared GITHUB_TOKEN, are for these only. Pure.

export const DEFAULT_DEMO_REPOS = ["vihuynh72/pinepoint"];

/** owner/name pairs from PINEPOINT_DEMO_REPOS (comma separated), lower-cased. */
export function demoRepos(raw: string | undefined = process.env.PINEPOINT_DEMO_REPOS): Set<string> {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^/\s]+\/[^/\s]+$/.test(s));
  return new Set(list.length > 0 ? list : DEFAULT_DEMO_REPOS);
}

export function isDemoRepo(owner: string, repo: string, raw?: string): boolean {
  return demoRepos(raw).has(`${owner}/${repo}`.toLowerCase());
}

/** The parts of a GitHub PR URL, or null. Never throws. */
export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}
