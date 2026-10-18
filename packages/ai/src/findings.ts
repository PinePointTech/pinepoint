// buildFindings(runId): the mission results of one run go in, findings with STE text come out
// (plan section 8.2, VI-12).
//
// Bug rule (VI-7 removed "the agent reported a page error": the Pine browser shows the agent no console):
//   1. A check failed on the preview and on the flake re-run.
//   2. If the production run fails the same check, the level is old_bug. Offer no fix.
//   3. Notes without a failed check give a Possible issue.
//   4. Failures with the same check name and target path form one finding.
//
// One failed preview mission is one failure, also when two of its checks failed (the coupon bug fails
// the message check and the total check at once). Two missions merge when they share the target path
// and at least one confirmed check name.
//
// `groupFindings` is pure. `buildFindings` loads the rows, groups, rewrites in STE, lints and inserts.

import {
  MissionResultSchema,
  sql,
  type CheckResult,
  type FindingRow,
  type MissionResult,
  type MissionRow,
  type RunRow,
} from "@pinepoint/core";
import type { Complete, TokenUsage } from "./client";
import { lintSte, rewriteSte, type SteText } from "./ste";

export type FindingLevel = NonNullable<FindingRow["level"]>;

/** One finding before the STE rewrite. The text is raw, from result.json. */
export interface DraftFinding {
  level: FindingLevel;
  /** Preview mission ids. The first one gives the persona and the lens in the review. */
  missionIds: string[];
  /** The names of the failed checks. Empty for a notes-only Possible issue. */
  checkNames: string[];
  path: string | null;
  line: number | null;
  expected: string | null;
  saw: string | null;
  /** What the production run saw for the same check. null when there was no production verdict. */
  productionSaw: string | null;
  screenshotUrl: string | null;
  text: SteText;
}

/** A draft with its rewritten text and the lint result. */
export interface BuiltFinding {
  draft: DraftFinding;
  text: SteText;
  attempts: number;
  lintErrors: string[];
}

export interface BuildFindingsOptions {
  /** Overrides PLANNER_MODEL. */
  model?: string;
  /** Overrides the Anthropic call. Tests use this. */
  complete?: Complete;
  /** Delete the findings of the run and build them again. Refused when one is posted on the PR. */
  force?: boolean;
  /** Build and lint, but write nothing. */
  dryRun?: boolean;
}

export interface BuildFindingsResult {
  /** The rows in the findings table. Empty on a dry run. */
  findings: FindingRow[];
  /** What this call built. Empty when the run already had findings. */
  built: BuiltFinding[];
  /** True when the run already had findings and this call changed nothing. */
  reused: boolean;
  usage: TokenUsage;
}

// ---------- reading result.json ----------

/** Parses missions.result back into a MissionResult. The runner adds keys, so parse loosely. */
export function readMissionResult(mission: Pick<MissionRow, "result">): MissionResult | null {
  if (!mission.result) return null;
  const parsed = MissionResultSchema.safeParse(mission.result);
  return parsed.success ? parsed.data : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function failedChecks(result: MissionResult | null): CheckResult[] {
  return result?.checks.filter((c) => !c.passed) ?? [];
}

function findCheck(result: MissionResult | null, name: string): CheckResult | undefined {
  return result?.checks.find((c) => c.name === name);
}

// ---------- grouping ----------

/** One sentence per check, so the rewrite (and the PR comment) sees which value belongs to which check. */
function joinChecks(checks: CheckResult[], pick: (c: CheckResult) => string): string {
  if (checks.length === 1) return pick(checks[0]!);
  return checks.map((c) => `${c.name}: ${pick(c).trim().replace(/\.$/, "")}.`).join(" ");
}

function rawTitle(checks: CheckResult[]): string {
  const first = checks[0]!;
  return `${first.name}: expected "${first.expected}", saw "${first.saw}"`;
}

/** The notes-only Possible issue of one preview mission (rule 3), or null when it wrote no notes. */
function notesFinding(preview: MissionRow, result: MissionResult | null): DraftFinding | null {
  const notes = [...(result?.notes ?? []), ...(result?.errors ?? [])].map(asText).filter((n) => n.trim() !== "");
  if (notes.length === 0) return null;
  return {
    level: "possible",
    missionIds: [preview.id],
    checkNames: [],
    path: preview.target_path,
    line: preview.target_line,
    expected: null,
    saw: null,
    productionSaw: null,
    screenshotUrl: preview.screenshot_url,
    text: { title: notes.join(" "), steps: result?.steps ?? [], expected: null, saw: null },
  };
}

/**
 * Groups the mission results of one run into draft findings. Pure: no network, no database.
 * The missions must be in their end states. `buildFindings` checks that before it calls this.
 */
export function groupFindings(missions: MissionRow[]): DraftFinding[] {
  const previews = missions.filter((m) => m.kind === "preview");
  const childrenOf = (parentId: string, kind: MissionRow["kind"]) =>
    missions.filter((m) => m.parent_id === parentId && m.kind === kind);

  const confirmed: DraftFinding[] = [];
  const possible: DraftFinding[] = [];

  for (const preview of previews) {
    const result = readMissionResult(preview);
    const failed = failedChecks(result);

    if (failed.length === 0) {
      const notes = notesFinding(preview, result);
      if (notes) possible.push(notes);
      continue;
    }

    const flake = childrenOf(preview.id, "flake")[0];
    const flakeResult = flake ? readMissionResult(flake) : null;
    const production = childrenOf(preview.id, "production")[0];
    const productionResult = production ? readMissionResult(production) : null;

    // Rule 1: a check counts when the flake re-run failed it too. A passed flake check was a flake.
    // A flake with no verdict (error, blocked, needs_you, no such check) leaves the check unconfirmed.
    const stillFailed = failed.filter((c) => findCheck(flakeResult, c.name)?.passed !== true);
    if (stillFailed.length === 0) continue;
    const confirmedChecks = stillFailed.filter((c) => findCheck(flakeResult, c.name)?.passed === false);

    const checks = confirmedChecks.length > 0 ? confirmedChecks : stillFailed;
    const productionChecks = checks.map((c) => findCheck(productionResult, c.name));
    const withProduction = checks.filter((_, i) => productionChecks[i] !== undefined);
    const draft: DraftFinding = {
      level: "possible",
      missionIds: [preview.id],
      checkNames: checks.map((c) => c.name),
      path: preview.target_path,
      line: preview.target_line,
      expected: joinChecks(checks, (c) => c.expected),
      saw: joinChecks(checks, (c) => c.saw),
      productionSaw:
        withProduction.length === 0 ? null : joinChecks(withProduction, (c) => findCheck(productionResult, c.name)!.saw),
      screenshotUrl: preview.screenshot_url,
      text: {
        title: rawTitle(checks),
        steps: result?.steps ?? [],
        expected: joinChecks(checks, (c) => c.expected),
        saw: joinChecks(checks, (c) => c.saw),
      },
    };

    if (confirmedChecks.length === 0) {
      possible.push(draft);
      continue;
    }

    // Rule 2: when production fails every confirmed check, the bug is old. Offer no fix.
    draft.level = productionChecks.every((pc) => pc?.passed === false) ? "old_bug" : "bug";

    // Rule 4: same target path and a shared check name -> one finding.
    const existing = confirmed.find(
      (f) => f.path === draft.path && f.checkNames.some((name) => draft.checkNames.includes(name)),
    );
    if (!existing) {
      confirmed.push(draft);
      continue;
    }
    existing.missionIds.push(preview.id);
    for (const name of draft.checkNames) if (!existing.checkNames.includes(name)) existing.checkNames.push(name);
    if (draft.level === "bug") existing.level = "bug";
    if (existing.productionSaw === null) existing.productionSaw = draft.productionSaw;
    if (existing.screenshotUrl === null) existing.screenshotUrl = draft.screenshotUrl;
    if (existing.line === null) existing.line = draft.line;
  }

  return [...confirmed, ...possible];
}

// ---------- database ----------

export async function loadRunMissions(runId: string): Promise<{ run: RunRow; missions: MissionRow[] }> {
  const db = sql();
  const [runs, missions] = await Promise.all([
    db`select * from runs where id = ${runId}`,
    db`select * from missions where run_id = ${runId} order by started_at nulls last, id`,
  ]);
  const run = (runs as RunRow[])[0];
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  return { run, missions: missions as MissionRow[] };
}

async function loadFindings(runId: string): Promise<FindingRow[]> {
  return (await sql()`select * from findings where run_id = ${runId} order by id`) as FindingRow[];
}

async function insertFinding(runId: string, built: BuiltFinding): Promise<FindingRow> {
  const { draft, text } = built;
  const rows = (await sql().query(
    `insert into findings
       (run_id, mission_ids, level, title, steps, expected, saw, production_saw, screenshot_url, path, line)
     values ($1, $2::uuid[], $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      runId,
      draft.missionIds,
      draft.level,
      text.title,
      JSON.stringify(text.steps),
      text.expected,
      text.saw,
      draft.productionSaw,
      draft.screenshotUrl,
      draft.path,
      draft.line,
    ],
  )) as FindingRow[];
  return rows[0]!;
}

/**
 * Builds the findings of one run and writes them to the findings table.
 * Runs once per run: a second call returns the existing rows. `force` rebuilds unposted findings.
 * Throws when a mission still runs, so the caller must wait for every end state first.
 */
export async function buildFindings(runId: string, options: BuildFindingsOptions = {}): Promise<BuildFindingsResult> {
  const { run, missions } = await loadRunMissions(runId);
  const open = missions.filter((m) => m.status === "queued" || m.status === "running");
  if (open.length > 0) {
    throw new Error(`Run ${runId} has ${open.length} mission(s) still open. Build the findings after every mission ends.`);
  }

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const existing = await loadFindings(runId);
  if (existing.length > 0) {
    if (!options.force) {
      return { findings: existing, built: [], reused: true, usage };
    }
    if (existing.some((f) => f.comment_id !== null)) {
      throw new Error(`Run ${runId} has findings posted on the PR. They cannot be rebuilt.`);
    }
  }

  const drafts = groupFindings(missions);
  const rewritten: BuiltFinding[] = await Promise.all(
    drafts.map(async (draft) => {
      // qa.md goes only with a notes-only draft, where the model judges whether the note is a problem.
      const qaMd = draft.checkNames.length === 0 ? run.qa_md : null;
      const result = await rewriteSte(draft.text, { model: options.model, complete: options.complete, qaMd });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      return { draft, text: result.text, attempts: result.attempts, lintErrors: result.lintErrors };
    }),
  );
  // A notes-only Possible issue that the model marks as no problem ("the feature worked") is dropped.
  // A failed check is never dropped: the Bug rule decides those, not the model.
  const built = rewritten.filter((item) => item.draft.checkNames.length > 0 || item.text.problem !== false);

  if (options.dryRun) {
    return { findings: [], built, reused: false, usage };
  }

  if (existing.length > 0) {
    await sql()`delete from findings where run_id = ${runId} and comment_id is null`;
  }
  // Insert after every rewrite succeeded, so a model error leaves no partial rows.
  const findings: FindingRow[] = [];
  for (const item of built) {
    findings.push(await insertFinding(runId, item));
  }
  return { findings, built, reused: false, usage };
}

/** The lint of a stored finding, for the acceptance script. */
export function lintFinding(finding: Pick<FindingRow, "title" | "steps" | "expected" | "saw">): string[] {
  return lintSte({
    title: finding.title ?? "",
    steps: Array.isArray(finding.steps) ? finding.steps.map(String) : [],
    expected: finding.expected,
    saw: finding.saw,
  });
}
