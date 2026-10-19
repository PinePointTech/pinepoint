import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { findDeploymentPreviewUrl, findVercelCommentPreviewUrl, getPrContext, readFileAt } from "./context";
import { NO_PREVIEW_BODY, postNoPreviewComment } from "./no-preview";

const REF = { owner: "o", repo: "r" };

type Deployment = { id: number; environment: string; created_at: string };
type Status = { state: string; environment_url?: string; target_url?: string };

function notFound(): Error {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

function fakeDeployments(deployments: Deployment[], statuses: Record<number, Status[]>): Octokit {
  return {
    repos: {
      listDeployments: async () => ({ data: deployments }),
      listDeploymentStatuses: async ({ deployment_id }: { deployment_id: number }) => ({
        data: statuses[deployment_id] ?? [],
      }),
    },
  } as unknown as Octokit;
}

test("findDeploymentPreviewUrl picks the deployment that matches the project name", async () => {
  const gh = fakeDeployments(
    [
      { id: 1, environment: "Preview – other-app", created_at: "2026-10-17T10:00:00Z" },
      { id: 2, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T09:00:00Z" },
    ],
    {
      1: [{ state: "success", environment_url: "https://other.vercel.app" }],
      2: [{ state: "success", environment_url: "https://demo-abc.vercel.app" }],
    },
  );
  assert.equal(await findDeploymentPreviewUrl(gh, REF, "sha", "pinepoint-demo-store"), "https://demo-abc.vercel.app");
});

test("findDeploymentPreviewUrl uses the newest matching deployment", async () => {
  const gh = fakeDeployments(
    [
      { id: 1, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T09:00:00Z" },
      { id: 2, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T11:00:00Z" },
    ],
    {
      1: [{ state: "success", environment_url: "https://old.vercel.app" }],
      2: [{ state: "in_progress" }, { state: "success", environment_url: "https://new.vercel.app" }],
    },
  );
  assert.equal(await findDeploymentPreviewUrl(gh, REF, "sha", "pinepoint-demo-store"), "https://new.vercel.app");
});

test("findDeploymentPreviewUrl returns null without a success status", async () => {
  const gh = fakeDeployments(
    [{ id: 1, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T09:00:00Z" }],
    { 1: [{ state: "failure", target_url: "https://vercel.com/x/y" }, { state: "pending" }] },
  );
  assert.equal(await findDeploymentPreviewUrl(gh, REF, "sha", "pinepoint-demo-store"), null);
});

test("findDeploymentPreviewUrl returns null when no deployment matches", async () => {
  const gh = fakeDeployments([{ id: 1, environment: "Production", created_at: "2026-10-17T09:00:00Z" }], {
    1: [{ state: "success", environment_url: "https://prod.example.com" }],
  });
  assert.equal(await findDeploymentPreviewUrl(gh, REF, "sha", "pinepoint-demo-store"), null);
});

test("findDeploymentPreviewUrl falls back to a vercel.app target_url only", async () => {
  const ok = fakeDeployments(
    [{ id: 1, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T09:00:00Z" }],
    { 1: [{ state: "success", target_url: "https://demo-xyz.vercel.app" }] },
  );
  assert.equal(await findDeploymentPreviewUrl(ok, REF, "sha", "pinepoint-demo-store"), "https://demo-xyz.vercel.app");
  const bad = fakeDeployments(
    [{ id: 1, environment: "Preview – pinepoint-demo-store", created_at: "2026-10-17T09:00:00Z" }],
    { 1: [{ state: "success", target_url: "https://vercel.com/team/project/abc" }] },
  );
  assert.equal(await findDeploymentPreviewUrl(bad, REF, "sha", "pinepoint-demo-store"), null);
});

function vercelComment(projects: object[]): string {
  const payload = Buffer.from(JSON.stringify({ isMonorepo: true, projects })).toString("base64");
  return `[vc]: #abc=:${payload}\nThe latest updates on your projects.`;
}

function fakeVercel(statusState: string, body: string): Octokit {
  return {
    repos: {
      getCombinedStatusForRef: async () => ({
        data: { statuses: [{ context: "Vercel – pinepoint-demo-store", state: statusState }] },
      }),
    },
    issues: { listComments: async () => ({ data: [{ user: { login: "vercel[bot]" }, body }] }) },
  } as unknown as Octokit;
}

test("findVercelCommentPreviewUrl reads the project previewUrl from the vercel[bot] comment", async () => {
  const body = vercelComment([
    { name: "pinepoint", previewUrl: "pinepoint-git-x.vercel.app", nextCommitStatus: "DEPLOYED" },
    { name: "pinepoint-demo-store", previewUrl: "demo-git-x.vercel.app", nextCommitStatus: "DEPLOYED" },
  ]);
  const url = await findVercelCommentPreviewUrl(fakeVercel("success", body), { ...REF, number: 1 }, "sha", "pinepoint-demo-store");
  assert.equal(url, "https://demo-git-x.vercel.app");
});

test("findVercelCommentPreviewUrl returns null when the Vercel status is not success", async () => {
  const body = vercelComment([
    { name: "pinepoint-demo-store", previewUrl: "demo-git-x.vercel.app", nextCommitStatus: "FAILED" },
  ]);
  const url = await findVercelCommentPreviewUrl(fakeVercel("failure", body), { ...REF, number: 1 }, "sha", "pinepoint-demo-store");
  assert.equal(url, null);
});

test("readFileAt returns null on 404", async () => {
  const gh = {
    repos: {
      getContent: async () => {
        throw notFound();
      },
    },
  } as unknown as Octokit;
  assert.equal(await readFileAt(gh, REF, "apps/demo-store/qa.md", "sha"), null);
});

test("getPrContext returns qaMd null on 404 and fills content", async () => {
  const files: Record<string, string> = { "apps/demo-store/lib/cart.ts": "export const x = 1;\n" };
  const gh = {
    pulls: {
      get: async (args: { mediaType?: { format: string } }) =>
        args.mediaType?.format === "diff"
          ? { data: "diff --git a/x b/x\n+line\n" }
          : {
              data: {
                number: 7,
                title: "T",
                state: "open",
                draft: false,
                html_url: "https://github.com/o/r/pull/7",
                head: { sha: "abc", ref: "feature", repo: { id: 1 } },
                base: { sha: "base", repo: { id: 1 } },
                user: { login: "vi" },
              },
            },
      listFiles: async () => ({
        data: [
          { filename: "apps/demo-store/lib/cart.ts", status: "modified", additions: 1, deletions: 0 },
          { filename: "old.ts", status: "removed", additions: 0, deletions: 3 },
        ],
      }),
    },
    repos: {
      getContent: async ({ path }: { path: string }) => {
        const text = files[path];
        if (text === undefined) throw notFound();
        return { data: { type: "file", content: Buffer.from(text).toString("base64") } };
      },
      listDeployments: async () => ({ data: [] }),
      listDeploymentStatuses: async () => ({ data: [] }),
      getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
    },
  } as unknown as Octokit;

  const ctx = await getPrContext("https://github.com/o/r/pull/7", gh);
  assert.equal(ctx.qaMd, null);
  assert.equal(ctx.previewUrl, null);
  assert.equal(ctx.headSha, "abc");
  assert.equal(ctx.author, "vi");
  assert.equal(ctx.url, "https://github.com/o/r/pull/7");
  assert.equal(ctx.changedFiles[0]?.content, "export const x = 1;\n");
  assert.equal(ctx.changedFiles[1]?.content, undefined);
  assert.equal(ctx.isFork, false);
  // Not a fork: the QA file is read at the head.
  assert.equal(ctx.qaRef, "abc");
});

test("getPrContext reads the QA file at the base for a PR from a fork and honors the configured path", async () => {
  const reads: string[] = [];
  const gh = {
    pulls: {
      get: async (args: { mediaType?: { format: string } }) =>
        args.mediaType?.format === "diff"
          ? { data: "diff --git a/x b/x\n+line\n" }
          : {
              data: {
                number: 8,
                title: "T",
                state: "open",
                draft: false,
                html_url: "https://github.com/o/r/pull/8",
                head: { sha: "forkhead", ref: "feature", repo: { id: 999 } },
                base: { sha: "basesha", repo: { id: 1 } },
                user: { login: "ext" },
              },
            },
      listFiles: async () => ({ data: [] }),
    },
    repos: {
      getContent: async ({ path, ref }: { path: string; ref: string }) => {
        reads.push(`${ref}:${path}`);
        if (path === "docs/qa.md" && ref === "basesha") return { data: { type: "file", content: Buffer.from("# QA\n").toString("base64") } };
        throw notFound();
      },
      listDeployments: async () => ({ data: [] }),
      listDeploymentStatuses: async () => ({ data: [] }),
      getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
    },
  } as unknown as Octokit;

  const ctx = await getPrContext("https://github.com/o/r/pull/8", gh, { qaMdPath: "docs/qa.md", previewProjectName: null, productionUrl: "https://prod.example" });
  assert.equal(ctx.isFork, true);
  assert.equal(ctx.qaRef, "basesha");
  assert.equal(ctx.qaMd, "# QA\n");
  assert.equal(ctx.productionUrl, "https://prod.example");
  assert.ok(reads.includes("basesha:docs/qa.md"));
  assert.ok(!reads.some((r) => r.startsWith("forkhead:")), "nothing is read from the fork's head");
});

test("postNoPreviewComment posts the exact body", async () => {
  let sent: { issue_number?: number; body?: string } = {};
  const gh = {
    issues: {
      createComment: async (args: { issue_number: number; body: string }) => {
        sent = args;
        return { data: { id: 42, html_url: "https://github.com/o/r/pull/7#issuecomment-42" } };
      },
    },
  } as unknown as Octokit;
  const res = await postNoPreviewComment({ owner: "o", repo: "r", number: 7 }, gh);
  assert.equal(sent.body, "No preview. No test.");
  assert.equal(NO_PREVIEW_BODY, "No preview. No test.");
  assert.equal(sent.issue_number, 7);
  assert.deepEqual(res, { commentId: 42, url: "https://github.com/o/r/pull/7#issuecomment-42" });
});
