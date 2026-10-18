// Drives a run with nobody on /app: call advanceRun in a loop inside next/server after(), then
// hand off to a fresh function call (POST /api/runs/[id]/drive) before this one hits its time
// limit. Vercel Hobby has no frequent cron, so the run chains itself.
//
// advanceRun is safe to call at the same time as a person's /app poll: every state change in
// packages/runner/src/orchestrate.ts is a conditional update on the current status, and the
// review posts once (the lock on runs.review_posted_at). So no extra lock is needed here.

import { advanceRun } from "@pinepoint/runner";
import { driveToken } from "@pinepoint/github/webhook";
import "./run-hooks";

/** Time for the loop in one function call. maxDuration is 300 seconds; the rest is margin. */
export const DRIVE_SLICE_MS = 240_000;
/** The whole chain stops this long after the run started. The /app poll can still finish it. */
export const DRIVE_CAP_MS = 40 * 60_000;
/** The gap between two advanceRun calls, the same as the dashboard poll. */
export const DRIVE_STEP_MS = 3_000;
/** The header that carries driveToken(GITHUB_WEBHOOK_SECRET, runId). */
export const DRIVE_HEADER = "x-pinepoint-drive";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DriveEnd = "finished" | "missing" | "capped" | "chained" | "chain_failed";

/** True when the run started more than DRIVE_CAP_MS ago. */
export function pastCap(startedAt: string | null, now = Date.now()): boolean {
  if (!startedAt) return false;
  return now - new Date(startedAt).getTime() > DRIVE_CAP_MS;
}

/**
 * Advances the run until it leaves `running`, the slice ends at `sliceEndsAt`, or the 40-minute
 * cap passes. When the slice ends first, it starts the next slice with POST /api/runs/[id]/drive.
 */
export async function driveRun(runId: string, sliceEndsAt = Date.now() + DRIVE_SLICE_MS): Promise<DriveEnd> {
  while (Date.now() < sliceEndsAt) {
    let status: string;
    let startedAt: string | null;
    try {
      const snap = await advanceRun(runId);
      if (!snap) {
        console.warn(`[drive] run ${runId} does not exist`);
        return "missing";
      }
      status = snap.run.status;
      startedAt = snap.run.started_at;
    } catch (err) {
      console.warn(`[drive] advanceRun failed for run ${runId}: ${(err as Error).message}`);
      await sleep(DRIVE_STEP_MS);
      continue;
    }
    if (status !== "running") {
      console.log(`[drive] run ${runId} is ${status}`);
      return "finished";
    }
    if (pastCap(startedAt)) {
      console.warn(`[drive] run ${runId} passed the ${DRIVE_CAP_MS / 60_000}-minute cap; stopping the chain`);
      return "capped";
    }
    await sleep(DRIVE_STEP_MS);
  }
  return chainDrive(runId);
}

/** Starts the next slice in a new function call. The drive route answers at once and works in after(). */
export async function chainDrive(runId: string): Promise<DriveEnd> {
  const base = process.env.APP_BASE_URL;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!base || !secret) {
    console.error(`[drive] cannot chain run ${runId}: APP_BASE_URL or GITHUB_WEBHOOK_SECRET is not set`);
    return "chain_failed";
  }
  const url = `${base.replace(/\/+$/, "")}/api/runs/${runId}/drive`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { [DRIVE_HEADER]: driveToken(secret, runId) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[drive] chain for run ${runId} got HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return "chain_failed";
    }
    console.log(`[drive] chained run ${runId}`);
    return "chained";
  } catch (err) {
    console.error(`[drive] chain for run ${runId} failed: ${(err as Error).message}`);
    return "chain_failed";
  }
}
