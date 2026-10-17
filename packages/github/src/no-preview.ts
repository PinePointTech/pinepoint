// Post "No preview. No test." on a PR that has no successful preview deployment (plan section 7).

import type { Octokit } from "@octokit/rest";
import { octokit, type PrRef } from "./client";

export const NO_PREVIEW_BODY = "No preview. No test.";

/** Posts the no-preview comment on the PR. */
export async function postNoPreviewComment(
  ref: PrRef,
  gh: Octokit = octokit(),
): Promise<{ commentId: number; url: string }> {
  const { data } = await gh.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    body: NO_PREVIEW_BODY,
  });
  return { commentId: data.id, url: data.html_url };
}
