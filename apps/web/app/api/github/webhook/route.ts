// POST /api/github/webhook: start a run by itself when a demo store PR is opened or updated.
//
// Events: pull_request (opened, reopened, synchronize, ready_for_review) and deployment_status
// (success, not Production). The Vercel preview is usually not ready at pull_request time, so
// deployment_status is the main trigger. The checks below run before the response, which must go
// out within GitHub's 10 seconds. Planning and driving the run happen in after().
//
//   401  no GITHUB_WEBHOOK_SECRET, or a bad X-Hub-Signature-256
//   200  ping, or skipped with a reason (other paths, a run exists, not the PR head, ...)
//   202  waiting for the preview, or the run is starting

import { after } from "next/server";
import { octokit, prUrl } from "@pinepoint/github";
import { findPreviewUrl } from "@pinepoint/github/context";
import {
  PR_ACTIONS,
  isDemoPreviewEnvironment,
  listPrPaths,
  openPrForSha,
  touchesPaths,
  verifySignature,
  webhookPaths,
} from "@pinepoint/github/webhook";
import { DRIVE_SLICE_MS, driveRun } from "@/lib/drive";
import { startRunForPr } from "@/lib/start-run";
import { activeRunFor, attachRun, claim, releaseClaim, type ClaimTarget } from "@/lib/webhook-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The planner, the first Computer starts and the first drive slice run in after(). */
export const maxDuration = 300;

type Skip = { skip: string };
type Octokit = ReturnType<typeof octokit>;

interface RepoPayload {
  repository?: { name?: string; owner?: { login?: string } };
}
interface PullRequestPayload extends RepoPayload {
  action?: string;
  pull_request?: { number?: number; state?: string; head?: { sha?: string } };
}
interface DeploymentStatusPayload extends RepoPayload {
  deployment_status?: { state?: string; environment?: string };
  deployment?: { sha?: string; environment?: string };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

function repoOf(p: RepoPayload): { owner: string; repo: string } | null {
  const owner = p.repository?.owner?.login;
  const repo = p.repository?.name;
  return owner && repo ? { owner, repo } : null;
}

function fromPullRequest(p: PullRequestPayload): ClaimTarget | Skip {
  if (!p.action || !PR_ACTIONS.has(p.action)) return { skip: `pull_request action "${p.action}" does not start a run.` };
  const ref = repoOf(p);
  const pr = p.pull_request;
  if (!ref || !pr?.number || !pr.head?.sha) return { skip: "The payload has no repository or pull request." };
  if (pr.state !== "open") return { skip: "The PR is not open." };
  return { ...ref, number: pr.number, headSha: pr.head.sha };
}

async function fromDeploymentStatus(p: DeploymentStatusPayload, gh: Octokit): Promise<ClaimTarget | Skip> {
  const state = p.deployment_status?.state;
  if (state !== "success") return { skip: `Deployment state is "${state}".` };
  const environment = p.deployment_status?.environment ?? p.deployment?.environment;
  if (!isDemoPreviewEnvironment(environment)) {
    return { skip: `Environment "${environment}" is not a demo store preview.` };
  }
  const ref = repoOf(p);
  const sha = p.deployment?.sha;
  if (!ref || !sha) return { skip: "The payload has no repository or deployment SHA." };
  const pr = await openPrForSha(gh, ref, sha);
  if (!pr.found) return { skip: pr.reason };
  return { ...ref, number: pr.number, headSha: pr.headSha };
}

/** Plans the run, saves it, starts the first Computers, then drives it. Runs in after(). */
async function startAndDrive(target: ClaimTarget, sliceEndsAt: number): Promise<void> {
  const label = `${target.owner}/${target.repo}#${target.number}@${target.headSha.slice(0, 7)}`;
  let runId: string;
  try {
    const outcome = await startRunForPr({
      prUrl: prUrl(target),
      noPreview: "skip",
      expectHeadSha: target.headSha,
    });
    if (outcome.status !== "running") {
      console.log(`[webhook] ${label}: no run (${outcome.status})`);
      await releaseClaim(target);
      return;
    }
    runId = outcome.runId;
    await attachRun(target, runId);
    console.log(`[webhook] ${label}: run ${runId} with ${outcome.missions} missions, ${outcome.started} started`);
  } catch (err) {
    console.error(`[webhook] ${label}: could not start a run: ${(err as Error).message}`);
    await releaseClaim(target).catch((e: Error) => console.error(`[webhook] release failed: ${e.message}`));
    return;
  }
  const end = await driveRun(runId, sliceEndsAt);
  console.log(`[webhook] ${label}: first drive slice for run ${runId} ended: ${end}`);
}

export async function POST(request: Request) {
  const sliceEndsAt = Date.now() + DRIVE_SLICE_MS;
  const raw = Buffer.from(await request.arrayBuffer());

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return json({ error: "GITHUB_WEBHOOK_SECRET is not set." }, 401);
  if (!verifySignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return json({ error: "Bad signature." }, 401);
  }

  const event = request.headers.get("x-github-event");
  if (event === "ping") return json({ ok: true, pong: true });
  if (event !== "pull_request" && event !== "deployment_status") {
    return json({ ok: true, skipped: `Event "${event}" is not handled.` });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return json({ error: "The body is not JSON. Set the content type to application/json." }, 400);
  }

  try {
    const gh = octokit();
    const target =
      event === "pull_request"
        ? fromPullRequest(payload as PullRequestPayload)
        : await fromDeploymentStatus(payload as DeploymentStatusPayload, gh);
    if ("skip" in target) return json({ ok: true, event, skipped: target.skip });

    const ref = { owner: target.owner, repo: target.repo, number: target.number };
    const prefixes = webhookPaths();
    if (!touchesPaths(await listPrPaths(gh, ref), prefixes)) {
      return json({ ok: true, event, pr: target.number, skipped: `The PR changes no file under ${prefixes.join(", ")}.` });
    }

    const existing = await activeRunFor(target);
    if (existing) {
      return json({ ok: true, event, pr: target.number, skipped: "A run exists for this commit.", runId: existing.id, status: existing.status });
    }

    if (!(await findPreviewUrl(gh, ref, target.headSha))) {
      return json({ ok: true, event, pr: target.number, waiting: "No preview yet. A deployment_status event will start the run." }, 202);
    }

    if (!(await claim(target))) {
      return json({ ok: true, event, pr: target.number, skipped: "Another delivery is starting the run for this commit." });
    }

    after(() => startAndDrive(target, sliceEndsAt));
    return json({ ok: true, event, pr: target.number, headSha: target.headSha, starting: true }, 202);
  } catch (err) {
    console.error(`[webhook] ${event} failed: ${(err as Error).message}`);
    return json({ error: (err as Error).message }, 500);
  }
}
