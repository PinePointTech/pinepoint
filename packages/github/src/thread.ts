// Replies in a finding's review comment thread (plan sections 7 and 9.4).

import { octokit, type PrRef } from "./client";

export type Decision = "bug" | "not_bug";

/** Posts a reply under a PR review comment. Returns the new comment id and URL. */
export async function replyInThread(
  ref: PrRef,
  commentId: number,
  body: string,
): Promise<{ id: number; url: string }> {
  const { data } = await octokit().pulls.createReplyForReviewComment({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    comment_id: commentId,
    body,
  });
  return { id: data.id, url: data.html_url };
}

/** Clock time in Pacific time, for example "4:32 PM". */
export function formatPtTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/ /g, " ");
}

/** The thread reply text for a decision (plan section 9.4). */
export function decisionReply(decision: Decision, date: Date): string {
  const time = formatPtTime(date);
  return decision === "bug"
    ? `Marked as Bug at ${time} PT.`
    : `Marked as Not a bug at ${time} PT. PinePoint stores this lesson.`;
}
