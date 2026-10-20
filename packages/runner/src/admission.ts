// Concurrency and daily quota slots for private runs (docs/github-access-contract.md section 8).
//
// A slot is one row in run_admissions with a unique (scope_key, slot). The insert picks the lowest
// free slot number under the limit, or inserts nothing: the primary key is the atomic gate, so two
// callers racing for the last slot cannot both get it. A run takes one slot per scope (user,
// repository, workspace, workspace-day). Live-run slots release when the run leaves the live
// states; the day slot never releases. Server code only.

import { LIMITS, sql } from "@pinepoint/core";

export interface AdmissionScope {
  userId: string;
  repositoryId: string;
  workspaceId: string;
}

export type AdmissionDenied = { admitted: false; scope: "user" | "repository" | "workspace" | "workspace_day"; limit: number };
export type AdmissionResult = { admitted: true } | AdmissionDenied;

/** The UTC day of a time, for the daily key. */
export function dayKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** The scope keys and limits a run needs. Pure. */
export function admissionKeys(scope: AdmissionScope, nowMs = Date.now()): Array<{ name: AdmissionDenied["scope"]; key: string; limit: number; releases: boolean }> {
  return [
    { name: "user", key: `user:${scope.userId}`, limit: LIMITS.userConcurrent, releases: true },
    { name: "repository", key: `repo:${scope.repositoryId}`, limit: LIMITS.repositoryConcurrent, releases: true },
    { name: "workspace", key: `ws:${scope.workspaceId}`, limit: LIMITS.workspaceConcurrent, releases: true },
    { name: "workspace_day", key: `ws:${scope.workspaceId}:day:${dayKey(nowMs)}`, limit: LIMITS.workspaceDaily, releases: false },
  ];
}

/** Takes the lowest free slot under `limit` for `key`. True when this call got one. One statement. */
async function takeSlot(key: string, limit: number, runId: string): Promise<boolean> {
  const rows = await sql()`
    insert into run_admissions (scope_key, slot, run_id)
    select ${key}, s, ${runId}
    from generate_series(1, ${limit}) as s
    where not exists (select 1 from run_admissions a where a.scope_key = ${key} and a.slot = s)
    order by s
    limit 1
    on conflict (scope_key, slot) do nothing
    returning slot
  `;
  return rows.length > 0;
}

/**
 * Admits a run into every scope, or releases what it took and says which scope is full. Call it
 * right after the run row exists (the slot references the run) and before any paid work.
 */
export async function admitRun(runId: string, scope: AdmissionScope, nowMs = Date.now()): Promise<AdmissionResult> {
  const taken: string[] = [];
  for (const k of admissionKeys(scope, nowMs)) {
    if (await takeSlot(k.key, k.limit, runId)) {
      taken.push(k.key);
      continue;
    }
    // Live-run slots held by runs that already ended are stale (a release was missed). Free them and try once more.
    await releaseStaleSlots(k.key);
    if (k.releases && (await takeSlot(k.key, k.limit, runId))) {
      taken.push(k.key);
      continue;
    }
    await sql().query(`delete from run_admissions where run_id = $1 and scope_key = any($2::text[])`, [runId, taken]);
    return { admitted: false, scope: k.name, limit: k.limit };
  }
  return { admitted: true };
}

/** Frees the live-run slots of a run. The day slot stays. Safe to call more than once. */
export async function releaseRunSlots(runId: string): Promise<number> {
  const rows = await sql()`
    delete from run_admissions where run_id = ${runId} and scope_key not like '%:day:%' returning slot
  `;
  return rows.length;
}

/** Frees live-run slots whose run is not live any more. A missed release cannot block a scope for good. */
export async function releaseStaleSlots(key?: string): Promise<number> {
  const rows = await sql().query(
    `delete from run_admissions a using runs r
     where a.run_id = r.id and a.scope_key not like '%:day:%'
       and r.status not in ('planning', 'running', 'reporting')
       and ($1::text is null or a.scope_key = $1)
     returning a.slot`,
    [key ?? null],
  );
  return rows.length;
}

/** Text for a 429 answer. */
export function admissionDeniedText(d: AdmissionDenied): string {
  switch (d.scope) {
    case "user":
      return `You already have ${d.limit} runs going. Wait for one to end.`;
    case "repository":
      return `This repository already has ${d.limit} runs going. Wait for one to end.`;
    case "workspace":
      return `This organization already has ${d.limit} runs going. Wait for one to end.`;
    case "workspace_day":
      return `This organization reached its ${d.limit} runs for today.`;
  }
}
