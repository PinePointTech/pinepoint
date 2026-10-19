// Posts one fix as a GitHub suggestion on the PR (plan sections 7 and 9.4, VI-16).
//
// The suggestion is a review comment on the fix range (start_line and line, side RIGHT) with a
// ```suggestion block. GitHub shows "Commit suggestion" on it. Then a reply in the finding thread
// links to it: "Proposed fix: {link}".

import type { Octokit } from "@octokit/rest";
import type { PrRef } from "./client";
import { replyInThread } from "./thread";

/** The part of a fix that the suggestion needs. The shape comes from @pinepoint/ai FixSchema. */
export type SuggestedFix = {
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
  explanation: string;
};

export type SuggestionPayload = {
  owner: string;
  repo: string;
  pull_number: number;
  commit_id: string;
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
};

/** A code fence that the replacement cannot close early. Three backticks, or more when the text has three. */
export function fenceFor(text: string): string {
  const longest = [...text.matchAll(/`{3,}/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/** The comment body: the explanation, then the suggestion block. */
export function suggestionBody(fix: SuggestedFix): string {
  const fence = fenceFor(fix.replacement);
  const replacement = fix.replacement.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return [`Proposed fix: ${fix.explanation.trim()}`, "", `${fence}suggestion`, replacement, fence].join("\n");
}

/**
 * The review comment payload. A one-line range has no start_line: GitHub rejects a start_line
 * that equals line.
 */
export function buildSuggestionPayload(ref: PrRef, headSha: string, fix: SuggestedFix): SuggestionPayload {
  const payload: SuggestionPayload = {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    commit_id: headSha,
    path: fix.path,
    body: suggestionBody(fix),
    line: fix.endLine,
    side: "RIGHT",
  };
  if (fix.startLine < fix.endLine) {
    payload.start_line = fix.startLine;
    payload.start_side = "RIGHT";
  }
  return payload;
}

/** The thread reply text (plan section 9.4). */
export function proposedFixReply(url: string): string {
  return `Proposed fix: ${url}`;
}

export type PostFixResult = {
  commentId: number;
  url: string;
  /** The reply in the finding thread, or on the PR when the finding has no thread. */
  replyUrl: string | null;
};

/**
 * Creates the suggestion comment on the fix range as `gh`, then replies in the finding thread with a
 * link to it. When the finding has no review comment, the reply goes on the PR as an issue comment.
 */
export async function postFixSuggestion(
  gh: Octokit,
  ref: PrRef,
  headSha: string,
  fix: SuggestedFix,
  findingCommentId: number | null,
  findingTitle = "Finding",
): Promise<PostFixResult> {
  const { data } = await gh.pulls.createReviewComment(buildSuggestionPayload(ref, headSha, fix));
  const reply = proposedFixReply(data.html_url);

  let replyUrl: string | null = null;
  try {
    if (findingCommentId !== null) {
      replyUrl = (await replyInThread(gh, ref, findingCommentId, reply)).url;
    } else {
      const issue = await gh.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        body: `${findingTitle}\n\n${reply}`,
      });
      replyUrl = issue.data.html_url;
    }
  } catch (err) {
    // The suggestion is on the PR. The link reply is a nicety, so do not fail the post.
    console.error("proposed fix reply failed", { commentId: data.id, status: (err as { status?: number }).status });
  }

  return { commentId: data.id, url: data.html_url, replyUrl };
}
