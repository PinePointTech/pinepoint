// The fix agent: the diff, the STE steps, the failure screenshot, the errors and the repo files go in,
// one fix as a GitHub suggestion comes out (plan section 8.3, VI-16).
//
// Flow: build the prompt, call FIX_MODEL with the screenshot as an image, parse the JSON, validate it:
// the range must be inside the diff on the right side, the explanation must be STE in 3 sentences or
// fewer. On a failure, retry one time with the error text. Then throw `FixError`.
//
// `proposeFix` is pure apart from the model call. `fixFinding` loads the finding, reads the PR from
// GitHub, calls `proposeFix` and writes findings.fix.

import { z } from "zod";
import { loadShot, shotIdFromPath, sql, type FindingRow, type MissionRow, type StoredShot } from "@pinepoint/core";
import { octokit, type PrRef } from "@pinepoint/github";
import { getPrDiff, readFilesWithinBudget, type RepoFile } from "@pinepoint/github/context";
import { completeWithAnthropic, fixModel, imageBlock, type Complete, type CompleteImage, type TokenUsage } from "./client";
import { annotateDiff, changedPaths, isInsideHunk, rightSideHunkLines } from "./diff";
import { readMissionResult } from "./findings";
import { extractJson } from "./planner";
import { lintSte, splitSentences } from "./ste";

export const FIX_CONFIDENCES = ["high", "medium", "low"] as const;
export type FixConfidence = (typeof FIX_CONFIDENCES)[number];

/** One fix from plan section 8.3. The replacement replaces lines startLine to endLine of path. */
export const FixSchema = z
  .object({
    path: z.string().trim().min(1, "path is empty."),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    replacement: z.string(),
    explanation: z.string().trim().min(1, "explanation is empty."),
    confidence: z.enum(FIX_CONFIDENCES),
  })
  .refine((fix) => fix.startLine <= fix.endLine, { message: "startLine must be at or before endLine." });
export type Fix = z.infer<typeof FixSchema>;

/** Rule 5: no fix inside the diff is possible. */
export const NoFixSchema = z.object({
  fix: z.null(),
  reason: z.string().trim().min(1, "reason is empty."),
});

const FixReplySchema = z.union([FixSchema, NoFixSchema]);

/** What `proposeFix` returns and what findings.fix stores. `fix` is null when the model gave a reason instead. */
export interface StoredFix {
  fix: Fix | null;
  /** The reason when fix is null. */
  reason: string | null;
  model: string;
  /** 1 when the first reply validated, 2 when the retry did. */
  attempts: number;
  createdAt: string;
}

/** Reads findings.fix back. Returns null for an empty or unknown value. */
export function readStoredFix(value: unknown): StoredFix | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<StoredFix>;
  if (typeof v.model !== "string" || typeof v.createdAt !== "string") return null;
  const fix = v.fix ? FixSchema.safeParse(v.fix) : null;
  return {
    fix: fix?.success ? fix.data : null,
    reason: typeof v.reason === "string" ? v.reason : null,
    model: v.model,
    attempts: typeof v.attempts === "number" ? v.attempts : 1,
    createdAt: v.createdAt,
  };
}

export interface FixInput {
  /** The PR diff, unified format. */
  diff: string;
  /** The finding text in STE. */
  title: string;
  steps: string[];
  expected: string | null;
  saw: string | null;
  /** The errors the missions reported, as text. */
  errors: string[];
  /** The failure screenshot: findings.screenshot_url, an absolute URL or a /api/shots/<id> path. */
  screenshotUrl: string | null;
  /**
   * The screenshot as the model gets it (loadScreenshotImage). fixFinding sets it. When it is not
   * set, an absolute http(s) screenshotUrl goes as a URL and a relative path goes nowhere.
   */
  screenshot?: CompleteImage | null;
  /** The files the diff touches, at the head SHA. 200 KB at most in total. */
  files: RepoFile[];
}

export interface ProposeFixOptions {
  /** Overrides FIX_MODEL. */
  model?: string;
  /** Overrides the Anthropic call. Tests use this. */
  complete?: Complete;
  /** Called after each attempt. The test script prints these. */
  onAttempt?: (info: { attempt: number; error: string | null }) => void;
}

export interface ProposeFixResult {
  stored: StoredFix;
  usage: TokenUsage;
}

/** Thrown when the model's reply does not validate after the retry. */
export class FixError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastReply: string,
  ) {
    super(message);
    this.name = "FixError";
  }
}

const MAX_TOKENS = 8192;
const MAX_EXPLANATION_SENTENCES = 3;

export const FIX_SYSTEM = [
  "You are the PinePoint fix agent. A simulated user found a bug on the preview of a pull request.",
  "You read the diff, the bug report, the failure screenshot, the errors and the changed files. You propose one fix as a GitHub suggestion.",
  "A developer reads the fix on the pull request and commits it with one click. The fix must be small, exact and complete.",
  "Return JSON only. No prose. No code fences.",
].join("\n");

/** The prompt rules from plan section 8.3, in order, plus two rules that make the suggestion apply. */
export const FIX_RULES = [
  "Return one fix only.",
  "Change only lines inside the diff, on the right side. Use the line numbers shown at the start of each line in the diff. The range from startLine to endLine must stay inside one hunk.",
  "The replacement replaces the full line range, from startLine to endLine. Write every line of the range again, also the lines that you keep. Keep the indentation of the file.",
  `Explain the fix in Simplified Technical English, in ${MAX_EXPLANATION_SENTENCES} sentences or fewer. Use 20 words or fewer per sentence. Do not use semicolons.`,
  'If no fix inside the diff is possible, return {"fix": null, "reason": "..."} with the reason in one sentence.',
  "Fix the bug the report describes. Do not change other behavior. Do not remove the feature the pull request adds.",
  "Pick the smallest range that holds the fix. Keep the code style of the file.",
];

/** A neutral example of the shape. It is not from the demo store, so it gives the model no answer. */
export const FIX_OUTPUT_EXAMPLE: Fix = {
  path: "src/checkout/total.ts",
  startLine: 40,
  endLine: 42,
  replacement:
    "  const total = subtotal + shipping;\n  if (total < 0) {\n    throw new Error(\"The total is negative.\");\n  }",
  explanation: "The total can go below zero. The fix stops a negative total.",
  confidence: "high",
};

/** The images that go to the model with the prompt: the failure screenshot, or none. */
export function fixImages(input: Pick<FixInput, "screenshotUrl" | "screenshot">): CompleteImage[] {
  const image = input.screenshot !== undefined ? input.screenshot : absoluteUrlImage(input.screenshotUrl);
  return image && imageBlock(image) ? [image] : [];
}

function absoluteUrlImage(url: string | null): CompleteImage | null {
  return url && /^https?:\/\//i.test(url) ? { url } : null;
}

/**
 * The failure screenshot as the model gets it. An absolute http(s) URL goes as it is. A
 * /api/shots/<id> path is read from mission_shots and goes as base64: Anthropic cannot fetch a
 * relative path. null when there is no picture or it cannot be read. `load` is for the tests.
 */
export async function loadScreenshotImage(
  url: string | null,
  load: (id: string) => Promise<StoredShot | null> = loadShot,
): Promise<CompleteImage | null> {
  const absolute = absoluteUrlImage(url);
  if (absolute) return absolute;
  const id = shotIdFromPath(url);
  if (!id) return null;
  try {
    const shot = await load(id);
    return shot ? { mediaType: shot.mediaType, data: shot.data.toString("base64") } : null;
  } catch (err) {
    console.warn(`[fix] could not load screenshot ${id}: ${(err as Error).message}`);
    return null;
  }
}

/** Builds the user prompt. Exported for the tests and for prompt reviews. */
export function buildFixPrompt(input: FixInput): string {
  const files = input.files
    .map((file) => {
      const body = file.content === undefined ? "(no content: deleted, binary or over the size budget)" : file.content;
      return `--- ${file.path} ---\n${body}`;
    })
    .join("\n\n");
  const errors = input.errors.filter((e) => e.trim() !== "");

  return [
    "## Rules",
    ...FIX_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    "## Output schema",
    "One JSON object with: path (string, the file path from the diff), startLine (integer), endLine (integer), " +
      `replacement (string, the new text for lines startLine to endLine), explanation (string, STE, ${MAX_EXPLANATION_SENTENCES} sentences or fewer), ` +
      `confidence (one of ${FIX_CONFIDENCES.join(", ")}).`,
    'Or, when no fix inside the diff is possible: {"fix": null, "reason": "..."}.',
    "Example:",
    JSON.stringify(FIX_OUTPUT_EXAMPLE, null, 2),
    "",
    "## Bug report",
    `Title: ${input.title}`,
    "Steps:",
    ...input.steps.map((step, i) => `${i + 1}. ${step}`),
    `Expected: ${input.expected ?? "(none)"}`,
    `Saw: ${input.saw ?? "(none)"}`,
    fixImages(input).length > 0
      ? "The image is the failure screenshot. It shows the screen at the moment the check failed."
      : "No failure screenshot.",
    "",
    "## Errors the simulated user saw",
    errors.length > 0 ? errors.map((e) => `- ${e}`).join("\n") : "(none)",
    "",
    "## Diff",
    "Each line in a hunk starts with its right-side line number. Only numbered lines are valid for startLine and endLine.",
    "```diff",
    annotateDiff(input.diff).trim(),
    "```",
    "",
    "## Changed files at the head of the PR",
    files || "(none)",
  ].join("\n");
}

/** Parses one reply. Returns the error text on a failure. */
export function parseFixReply(text: string): { reply: z.infer<typeof FixReplySchema> } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { error: `The reply is not valid JSON: ${(err as Error).message}` };
  }
  const result = FixReplySchema.safeParse(json);
  if (!result.success) {
    return { error: z.prettifyError(result.error) };
  }
  return { reply: result.data };
}

/**
 * Checks a parsed fix against the diff and the STE rules (plan section 8.3, rules 2 and 4).
 * Returns one message per problem. An empty list means the fix is valid.
 */
export function validateFix(fix: Fix, diff: string): string[] {
  const errors: string[] = [];
  const lines = rightSideHunkLines(diff);
  if (!lines.has(fix.path)) {
    errors.push(`path "${fix.path}" is not a file with a right side in the diff. Valid paths: ${[...lines.keys()].join(", ") || "(none)"}.`);
  } else if (!isInsideHunk(lines, fix.path, fix.startLine, fix.endLine)) {
    const shown = [...lines.get(fix.path)!].sort((a, b) => a - b);
    errors.push(
      `lines ${fix.startLine}-${fix.endLine} of ${fix.path} are not all inside one hunk on the right side of the diff. ` +
        `The diff shows lines ${describeRanges(shown)}.`,
    );
  }
  const sentences = splitSentences(fix.explanation);
  if (sentences.length > MAX_EXPLANATION_SENTENCES) {
    errors.push(`explanation has ${sentences.length} sentences, the limit is ${MAX_EXPLANATION_SENTENCES}.`);
  }
  for (const problem of lintSte({ title: fix.explanation, steps: [], expected: null, saw: null })) {
    errors.push(problem.replace(/^title /, "explanation "));
  }
  return errors;
}

/** "10-17, 32-40" from a sorted list of line numbers. */
function describeRanges(sorted: number[]): string {
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const n of sorted) {
    if (start === null || prev === null || n !== prev + 1) {
      if (start !== null && prev !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = n;
    }
    prev = n;
  }
  if (start !== null && prev !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut at ${max} characters)`;
}

/**
 * Proposes one fix with FIX_MODEL. Validates the reply. On a failure, calls the model one more
 * time with the errors. Throws `FixError` when the retry does not validate either.
 */
export async function proposeFix(input: FixInput, options: ProposeFixOptions = {}): Promise<ProposeFixResult> {
  const model = options.model ?? fixModel();
  const complete = options.complete ?? completeWithAnthropic;
  const prompt = buildFixPrompt(input);
  const images = fixImages(input);
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  let lastError = "";
  let lastReply = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryNote =
      attempt === 1
        ? ""
        : [
            "",
            "## Your previous reply did not validate",
            "Fix these problems and return the full JSON again:",
            lastError,
            "",
            "## Your previous reply",
            clip(lastReply, 20_000),
          ].join("\n");

    const reply = await complete({ model, system: FIX_SYSTEM, prompt: prompt + retryNote, maxTokens: MAX_TOKENS, images });
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    lastReply = reply.text;

    const parsed = parseFixReply(reply.text);
    if ("error" in parsed) {
      lastError = parsed.error;
    } else if ("fix" in parsed.reply) {
      options.onAttempt?.({ attempt, error: null });
      return {
        stored: { fix: null, reason: parsed.reply.reason, model, attempts: attempt, createdAt: new Date().toISOString() },
        usage,
      };
    } else {
      const problems = validateFix(parsed.reply, input.diff);
      if (problems.length === 0) {
        options.onAttempt?.({ attempt, error: null });
        return {
          stored: { fix: parsed.reply, reason: null, model, attempts: attempt, createdAt: new Date().toISOString() },
          usage,
        };
      }
      lastError = problems.map((p) => `- ${p}`).join("\n");
    }
    options.onAttempt?.({ attempt, error: lastError });
  }

  throw new FixError(`The fix reply did not validate after 2 attempts:\n${lastError}`, 2, lastReply);
}

// ---------- database and GitHub ----------

export interface FixFindingOptions extends ProposeFixOptions {
  /** Build a new fix also when the finding has one. */
  force?: boolean;
  /** Build and validate, but write nothing. */
  dryRun?: boolean;
}

export interface FixFindingResult {
  stored: StoredFix;
  /** True when the finding already had a fix and this call changed nothing. */
  reused: boolean;
  usage: TokenUsage;
  /** The diff the fix was checked against. null when the fix was reused. */
  diff: string | null;
}

type FindingWithRun = FindingRow & { owner: string; repo: string; pr_number: number; head_sha: string | null };

export async function loadFindingWithRun(findingId: string): Promise<FindingWithRun | null> {
  const rows = (await sql()`
    select f.*, r.owner, r.repo, r.pr_number, r.head_sha
    from findings f join runs r on r.id = f.run_id
    where f.id = ${findingId}
  `) as FindingWithRun[];
  return rows[0] ?? null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The errors the preview missions and their flake re-runs reported, as text, without duplicates. */
export async function loadMissionErrors(missionIds: string[]): Promise<string[]> {
  if (missionIds.length === 0) return [];
  const missions = (await sql().query(
    `select * from missions where id = any($1::uuid[]) or (parent_id = any($1::uuid[]) and kind = 'flake')`,
    [missionIds],
  )) as MissionRow[];
  const errors = new Set<string>();
  for (const mission of missions) {
    for (const error of readMissionResult(mission)?.errors ?? []) {
      const text = asText(error).trim();
      if (text !== "") errors.add(text);
    }
  }
  return [...errors];
}

/**
 * Proposes the fix of one finding and writes it to findings.fix.
 * Returns the stored fix when the finding has one, unless `force` is set.
 * Throws when the finding is not a Bug: an old bug gets no fix (plan section 3).
 */
export async function fixFinding(findingId: string, options: FixFindingOptions = {}): Promise<FixFindingResult> {
  const finding = await loadFindingWithRun(findingId);
  if (!finding) throw new Error(`Finding ${findingId} does not exist.`);
  if (finding.level !== "bug") {
    throw new Error(`Finding ${findingId} has level ${finding.level ?? "null"}. Only a Bug gets a fix.`);
  }
  if (!finding.head_sha) throw new Error(`The run of finding ${findingId} has no head SHA.`);

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const existing = readStoredFix(finding.fix);
  if (existing && !options.force) {
    return { stored: existing, reused: true, usage, diff: null };
  }

  const ref: PrRef = { owner: finding.owner, repo: finding.repo, number: finding.pr_number };
  const gh = octokit();
  const [diff, errors, screenshot] = await Promise.all([
    getPrDiff(gh, ref),
    loadMissionErrors(finding.mission_ids ?? []),
    loadScreenshotImage(finding.screenshot_url),
  ]);
  const files = await readFilesWithinBudget(gh, ref, changedPaths(diff), finding.head_sha);

  const result = await proposeFix(
    {
      diff,
      title: finding.title ?? "",
      steps: Array.isArray(finding.steps) ? finding.steps.map(String) : [],
      expected: finding.expected,
      saw: finding.saw,
      errors,
      screenshotUrl: finding.screenshot_url,
      screenshot,
      files,
    },
    options,
  );
  usage.inputTokens += result.usage.inputTokens;
  usage.outputTokens += result.usage.outputTokens;

  if (!options.dryRun) {
    await sql().query(`update findings set fix = $2::jsonb where id = $1`, [findingId, JSON.stringify(result.stored)]);
  }
  return { stored: result.stored, reused: false, usage, diff };
}
