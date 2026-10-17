// Posts one PR review for a run: a summary and one inline comment per Bug (plan sections 7 and 9.4).
// The lock on runs.review_posted_at makes sure that the review posts only one time.

// @pinepoint/github has no package dependency on @pinepoint/core, so import its db module by path.
import { sql } from "../../core/src/db";
import { octokit } from "./client";
import { bugCommentBody, summaryBody, type ReviewFinding } from "./review-text";

export type ReviewComment = { path: string; line: number; side: "RIGHT"; body: string };

export type ReviewPayload = {
  owner: string;
  repo: string;
  pull_number: number;
  commit_id: string;
  event: "COMMENT";
  body: string;
  comments: ReviewComment[];
};

export type ReviewRun = {
  id: string;
  owner: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  author: string | null;
};

export type ReviewMission = { id: string; lens: string | null; persona: string | null; status: string };

/** A findings row with the columns that the review reads. */
export type FindingRow = {
  id: string;
  mission_ids: string[] | null;
  level: "bug" | "possible" | "old_bug";
  title: string;
  steps: unknown;
  expected: string | null;
  saw: string | null;
  production_saw: string | null;
  screenshot_url: string | null;
  path: string | null;
  line: number | null;
};

export type PostReviewResult = { posted: boolean; reviewId?: number; payload: ReviewPayload };

/** Builds the review payload from the rows. Pure, so the fixture and the tests can use it. */
export function buildReviewPayload(
  run: ReviewRun,
  missions: ReviewMission[],
  findings: FindingRow[],
  appBaseUrl: string,
): ReviewPayload {
  const byId = new Map(missions.map((m) => [m.id, m]));
  const toReview = (f: FindingRow): ReviewFinding => {
    const first = f.mission_ids?.length ? byId.get(f.mission_ids[0]!) : undefined;
    return {
      id: f.id,
      level: f.level,
      title: f.title,
      steps: Array.isArray(f.steps) ? f.steps.map(String) : [],
      expected: f.expected,
      saw: f.saw,
      production_saw: f.production_saw,
      screenshot_url: f.screenshot_url,
      path: f.path,
      line: f.line,
      persona: first?.persona ?? null,
      lens: first?.lens ?? null,
    };
  };
  const all = findings.map(toReview);
  const bugs = all.filter((f) => f.level === "bug");
  const inline = bugs.filter((f) => f.path && f.line != null);

  const body = summaryBody({
    appBaseUrl,
    runId: run.id,
    author: run.author,
    bugs: bugs.length,
    passed: missions.filter((m) => m.status === "passed").length,
    blocked: missions.filter((m) => m.status === "blocked").length,
    possible: all.filter((f) => f.level === "possible"),
    oldBugs: all.filter((f) => f.level === "old_bug"),
    bugsWithoutLine: bugs.filter((f) => !f.path || f.line == null),
  });

  return {
    owner: run.owner,
    repo: run.repo,
    pull_number: run.pr_number,
    commit_id: run.head_sha,
    event: "COMMENT",
    body,
    comments: inline.map((f) => ({
      path: f.path!,
      line: f.line!,
      side: "RIGHT",
      body: bugCommentBody(appBaseUrl, run.id, f),
    })),
  };
}

/** Loads the run, its missions and findings, and posts the review one time. */
export async function postReview(
  runId: string,
  opts: { dryRun?: boolean } = {},
): Promise<PostReviewResult> {
  const db = sql();
  const [run] = (await db.query(
    "select id, owner, repo, pr_number, head_sha, author from runs where id = $1",
    [runId],
  )) as ReviewRun[];
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.head_sha) throw new Error(`Run ${runId} has no head_sha.`);

  const missions = (await db.query(
    "select id, lens, persona, status from missions where run_id = $1 and kind = 'preview'",
    [runId],
  )) as ReviewMission[];
  const findings = (await db.query(
    `select id, mission_ids, level, title, steps, expected, saw, production_saw, screenshot_url, path, line
       from findings where run_id = $1 order by id`,
    [runId],
  )) as FindingRow[];

  const payload = buildReviewPayload(run, missions, findings, appBaseUrl());
  if (opts.dryRun) return { posted: false, payload };

  const locked = await db.query(
    "update runs set review_posted_at = now() where id = $1 and review_posted_at is null returning id",
    [runId],
  );
  if (locked.length === 0) return { posted: false, payload };

  const gh = octokit();
  let reviewId: number;
  try {
    const { data } = await gh.pulls.createReview(payload);
    reviewId = data.id;
  } catch (err) {
    // Clear the lock so that a retry can post.
    await db.query("update runs set review_posted_at = null where id = $1", [runId]);
    throw err;
  }
  await db.query("update runs set review_id = $2 where id = $1", [runId, reviewId]);

  const comments = await gh.paginate(gh.pulls.listCommentsForReview, {
    owner: run.owner,
    repo: run.repo,
    pull_number: run.pr_number,
    review_id: reviewId,
    per_page: 100,
  });
  for (const f of findings) {
    if (f.level !== "bug" || !f.path || f.line == null) continue;
    const c = comments.find((c) => c.path === f.path && (c.line ?? c.original_line) === f.line);
    if (c) await db.query("update findings set comment_id = $2 where id = $1", [f.id, c.id]);
  }

  return { posted: true, reviewId, payload };
}

/** APP_BASE_URL from the env. Throws a clear error when it is missing. */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) throw new Error("APP_BASE_URL is not set. Put it in .env.local.");
  return url;
}
