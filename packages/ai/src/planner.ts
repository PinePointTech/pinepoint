// The planner: the diff, qa.md and the changed files go in, 10 missions come out (plan section 8.1).
//
// Flow: build the prompt, call PLANNER_MODEL, parse the JSON, validate it with PlanSchema from
// @pinepoint/core. On a failure, retry one time with the error text. Then set each target to
// null when its line is not an added or changed line on the right side of the diff.

import { z } from "zod";
import { LENSES, MISSIONS_PER_RUN, PlanSchema, type Mission } from "@pinepoint/core";
import { completeWithAnthropic, plannerModel, type Complete, type TokenUsage } from "./client";
import { annotateDiff, isRightSideLine, rightSideLines } from "./diff";

/** One changed file at the head SHA. `content` is the full file; omit it for a deleted or binary file. */
export interface ChangedFile {
  path: string;
  content?: string;
}

export interface PlannerInput {
  /** The PR diff, unified format (GitHub: Accept: application/vnd.github.v3.diff). */
  diff: string;
  /** apps/demo-store/qa.md at the head SHA. */
  qaMd: string;
  /** The files the diff touches, with their content at the head SHA. */
  changedFiles: ChangedFile[];
}

export interface PlannerOptions {
  /** Overrides PLANNER_MODEL. */
  model?: string;
  /** Overrides the Anthropic call. Tests use this. */
  complete?: Complete;
  /** Called after each attempt. The test script prints these. */
  onAttempt?: (info: { attempt: number; error: string | null }) => void;
}

export interface PlanResult {
  missions: Mission[];
  model: string;
  /** 1 when the first reply validated, 2 when the retry did. */
  attempts: number;
  usage: TokenUsage;
  /** Targets the model set that were not on the right side of the diff. They are null now. */
  droppedTargets: Array<{ index: number; path: string; line: number }>;
}

/** Thrown when the model's reply does not validate after the retry. */
export class PlannerError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastReply: string,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

const MAX_TOKENS = 8192;
const MAX_FILE_CHARS = 40_000;

export const PLANNER_SYSTEM = [
  "You are the PinePoint planner. You read a pull request and write missions for simulated users.",
  "A mission is one simulated user with one goal and exact checks.",
  "The simulated users run on the Vercel preview of the pull request. They can click, type, scroll and read the screen.",
  "Return JSON only. No prose. No code fences.",
].join("\n");

/** The prompt rules from plan section 8.1, in order. */
export const PLANNER_RULES = [
  `Write exactly ${MISSIONS_PER_RUN} missions.`,
  "Aim the missions at the changed code. Each mission targets one added or changed line on the right side of the diff, or null. Use the line numbers shown at the start of each + line in the diff. Never target a - line or a context line.",
  `Use the five lenses: ${LENSES.join(", ")}. Pick lenses that fit the change. A CSS change gets UI missions. A form or logic change gets Abuse missions.`,
  'Give each mission 1 to 3 exact checks. Each check has a literal expected text that the agent can read on the screen, for example "$21.60". Take the expected text from qa.md.',
  "Use only test data from qa.md. Never use real payment data. Never sign in.",
  "Set newFeature to true when production cannot have the feature, for example a new coupon code that the diff adds.",
  "Return JSON only, in the output schema below.",
  "Write the persona and the goal in plain, short English. One goal per mission.",
];

export const PLANNER_OUTPUT_EXAMPLE = {
  missions: [
    {
      lens: "Abuse",
      persona: "Coupon abuser",
      goal: "Apply SAVE10 two times and read the total.",
      checks: [{ name: "Total after SAVE10 two times", expected: "$21.60" }],
      target: { path: "apps/demo-store/lib/cart.ts", line: 31 },
      newFeature: false,
    },
  ],
};

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut at ${max} characters)`;
}

/** Builds the user prompt. Exported for the tests and for prompt reviews. */
export function buildPlannerPrompt(input: PlannerInput): string {
  const files = input.changedFiles
    .map((file) => {
      const body = file.content === undefined ? "(no content: deleted or binary)" : clip(file.content, MAX_FILE_CHARS);
      return `--- ${file.path} ---\n${body}`;
    })
    .join("\n\n");

  return [
    "## Rules",
    ...PLANNER_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    "## Output schema",
    "One JSON object. `missions` is an array of exactly " +
      `${MISSIONS_PER_RUN} objects. Each has: lens (one of ${LENSES.join(", ")}), persona (string), goal (string), ` +
      "checks (1 to 3 objects with name and expected), target ({ path, line } or null), newFeature (boolean).",
    "Example with one mission:",
    JSON.stringify(PLANNER_OUTPUT_EXAMPLE, null, 2),
    "",
    "## qa.md",
    input.qaMd.trim(),
    "",
    "## Diff",
    "Each line in a hunk starts with its right-side line number. Only lines marked + are valid targets.",
    "```diff",
    annotateDiff(input.diff).trim(),
    "```",
    "",
    "## Changed files at the head of the PR",
    files || "(none)",
  ].join("\n");
}

/** Strips code fences and any text around the first `{` … last `}`. */
export function extractJson(text: string): string {
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fence) {
    body = fence[1]!.trim();
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The reply has no JSON object.");
  }
  return body.slice(start, end + 1);
}

/** Parses and validates one reply. Returns the error text on a failure. */
export function parsePlan(text: string): { plan: z.infer<typeof PlanSchema> } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { error: `The reply is not valid JSON: ${(err as Error).message}` };
  }
  const result = PlanSchema.safeParse(json);
  if (!result.success) {
    return { error: z.prettifyError(result.error) };
  }
  return { plan: result.data };
}

/**
 * Sets each target to null when its line is not an added or changed line on the right side
 * of the diff (plan section 8.1, rule 2). Returns the new missions and the dropped targets.
 */
export function clampTargets(
  missions: Mission[],
  diff: string,
): { missions: Mission[]; droppedTargets: PlanResult["droppedTargets"] } {
  const lines = rightSideLines(diff);
  const droppedTargets: PlanResult["droppedTargets"] = [];
  const next = missions.map((mission, index) => {
    if (mission.target && !isRightSideLine(lines, mission.target.path, mission.target.line)) {
      droppedTargets.push({ index, ...mission.target });
      return { ...mission, target: null };
    }
    return mission;
  });
  return { missions: next, droppedTargets };
}

/**
 * Plans 10 missions for one PR.
 * Throws `PlannerError` when the model's reply does not validate after one retry.
 */
export async function planMissions(input: PlannerInput, options: PlannerOptions = {}): Promise<PlanResult> {
  const model = options.model ?? plannerModel();
  const complete = options.complete ?? completeWithAnthropic;
  const prompt = buildPlannerPrompt(input);
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
            "Fix these errors and return the full JSON again:",
            lastError,
            "",
            "## Your previous reply",
            clip(lastReply, 20_000),
          ].join("\n");

    const reply = await complete({ model, system: PLANNER_SYSTEM, prompt: prompt + retryNote, maxTokens: MAX_TOKENS });
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    lastReply = reply.text;

    const parsed = parsePlan(reply.text);
    if ("plan" in parsed) {
      options.onAttempt?.({ attempt, error: null });
      const { missions, droppedTargets } = clampTargets(parsed.plan.missions, input.diff);
      return { missions, model, attempts: attempt, usage, droppedTargets };
    }
    lastError = parsed.error;
    options.onAttempt?.({ attempt, error: lastError });
  }

  throw new PlannerError(`The planner reply did not validate after 2 attempts:\n${lastError}`, 2, lastReply);
}
