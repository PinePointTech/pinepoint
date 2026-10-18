// The STE rewrite and the STE lint for one finding (plan section 8.2).
//
// Flow: build the prompt, call PLANNER_MODEL, parse the JSON, lint the text in TypeScript.
// On a lint failure, call the model one more time with the lint errors. Then keep the text,
// also when the second reply still fails the lint. The lint result goes back to the caller.

import { z } from "zod";
import { completeWithAnthropic, plannerModel, type Complete, type TokenUsage } from "./client";
import { extractJson } from "./planner";

/** The text of one finding that the rewrite changes and the lint checks. */
export interface SteText {
  title: string;
  steps: string[];
  expected: string | null;
  saw: string | null;
  /**
   * False when the draft reports no problem, for example a note that says the feature worked.
   * Only the model sets it. `buildFindings` drops a notes-only Possible issue with `problem: false`.
   */
  problem?: boolean;
}

/** Lint limits from plan section 8.2. */
export const MAX_WORDS_PER_STEP = 8;
export const MAX_WORDS_PER_SENTENCE = 20;

/** The STE rules from plan section 8.2, in order, plus one rule that keeps the screen values exact. */
export const STE_RULES = [
  "Use active voice and the simple present tense.",
  `Write one action per step. Use ${MAX_WORDS_PER_STEP} words or fewer per step.`,
  `Use ${MAX_WORDS_PER_SENTENCE} words or fewer per sentence.`,
  "Do not use semicolons.",
  'Do not use phrasal verbs. For example, write "open", not "pull up".',
  "Use the label text from the screen. Use the same name for the same item every time.",
  "Do not guess a cause. State what the user saw.",
  'Keep every literal screen value unchanged: prices such as "$21.60", codes such as SAVE10, and messages such as "Coupon already applied."',
  "Write only the actions a user takes in the browser as steps. Drop steps about screenshots, files, result.json or the check list. Put what the user sees in saw, not in a step.",
  "Keep the steps that lead to the problem. Drop steps after it.",
];

export const STE_SYSTEM = [
  "You are the PinePoint report writer. You rewrite a bug report in Simplified Technical English (STE).",
  "A developer reads the report on a pull request. The report must be short, exact and easy to follow.",
  "Return JSON only. No prose. No code fences.",
].join("\n");

export const STE_OUTPUT_EXAMPLE: SteText = {
  title: "SAVE10 applies two times",
  steps: ["Open the store.", "Add the Sage linen apron to the cart.", "Enter SAVE10. Click Apply.", "Enter SAVE10 again. Click Apply."],
  expected: "The total shows $21.60.",
  saw: "The total shows $19.44.",
  problem: true,
};

const MAX_TOKENS = 2048;

/**
 * Builds the user prompt for one rewrite. Exported for the tests and for prompt reviews.
 * `qaMd` is the store's qa.md. With it, the model can mark a note as no problem when qa.md
 * describes that behavior as expected (for example "A page reload empties the cart").
 */
export function buildSteRewritePrompt(draft: SteText, qaMd?: string | null): string {
  return [
    "## Rules",
    ...STE_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    "## Output schema",
    "One JSON object with: title (string, one short sentence, no final period), steps (array of strings, one action each), " +
      "expected (string or null), saw (string or null), problem (boolean). Keep expected and saw null when the draft has null. " +
      "When the draft lists two checks, write expected and saw as one sentence per check. " +
      "Set problem to false only when the draft reports no problem at all: a note that says the feature worked as expected, " +
      "or a note about behavior that qa.md describes as expected.",
    "Example:",
    JSON.stringify(STE_OUTPUT_EXAMPLE, null, 2),
    ...(qaMd?.trim() ? ["", "## qa.md", qaMd.trim()] : []),
    "",
    "## Draft to rewrite",
    JSON.stringify(draft, null, 2),
  ].join("\n");
}

const SteReplySchema = z.object({
  title: z.string().trim().min(1, "The title is empty."),
  steps: z.array(z.string().trim().min(1, "A step is empty.")),
  expected: z.string().trim().nullable().default(null),
  saw: z.string().trim().nullable().default(null),
  problem: z.boolean().default(true),
});

/** Parses one reply. Returns the error text on a failure. */
export function parseSteReply(text: string): { text: SteText } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { error: `The reply is not valid JSON: ${(err as Error).message}` };
  }
  const result = SteReplySchema.safeParse(json);
  if (!result.success) {
    return { error: z.prettifyError(result.error) };
  }
  return { text: result.data };
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Splits text into sentences at `.`, `!` or `?` followed by a space or the end.
 * "$21.60" has a digit after the period, so it does not split.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[.!?](?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * The STE lint from plan section 8.2: no semicolons, at most 8 words per step, at most 20 words
 * per sentence. Returns one message per problem. An empty list means the text passes.
 */
export function lintSte(text: SteText): string[] {
  const errors: string[] = [];
  const fields: Array<[string, string | null]> = [
    ["title", text.title],
    ...text.steps.map((step, i): [string, string] => [`step ${i + 1}`, step]),
    ["expected", text.expected],
    ["saw", text.saw],
  ];

  for (const [name, value] of fields) {
    if (value === null) continue;
    if (value.includes(";")) {
      errors.push(`${name} has a semicolon: "${value}"`);
    }
    for (const sentence of splitSentences(value)) {
      const words = wordCount(sentence);
      if (words > MAX_WORDS_PER_SENTENCE) {
        errors.push(`${name} has a sentence with ${words} words, the limit is ${MAX_WORDS_PER_SENTENCE}: "${sentence}"`);
      }
    }
  }

  text.steps.forEach((step, i) => {
    const words = wordCount(step);
    if (words > MAX_WORDS_PER_STEP) {
      errors.push(`step ${i + 1} has ${words} words, the limit is ${MAX_WORDS_PER_STEP}: "${step}"`);
    }
  });

  return errors;
}

export interface RewriteSteOptions {
  /** Overrides PLANNER_MODEL. */
  model?: string;
  /** Overrides the Anthropic call. Tests use this. */
  complete?: Complete;
  /** The store's qa.md, for the `problem` judgment. */
  qaMd?: string | null;
}

export interface RewriteSteResult {
  /** The text to keep. The second reply when there was a retry, also when it still fails the lint. */
  text: SteText;
  /** 1 when the first reply passed the lint, 2 when a retry ran. */
  attempts: number;
  /** The lint errors of the kept text. Empty when it passes. */
  lintErrors: string[];
  usage: TokenUsage;
}

/**
 * Rewrites one finding in STE with PLANNER_MODEL. Lints the reply. On a lint failure or a reply
 * that does not parse, calls the model one more time with the errors. Then keeps the text.
 */
export async function rewriteSte(draft: SteText, options: RewriteSteOptions = {}): Promise<RewriteSteResult> {
  const model = options.model ?? plannerModel();
  const complete = options.complete ?? completeWithAnthropic;
  const prompt = buildSteRewritePrompt(draft, options.qaMd);
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  let kept: SteText = draft;
  let lintErrors = lintSte(draft);
  let lastReply = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryNote =
      attempt === 1
        ? ""
        : [
            "",
            "## Your previous reply did not pass the lint",
            "Fix these problems and return the full JSON again:",
            ...lintErrors.map((e) => `- ${e}`),
            "",
            "## Your previous reply",
            lastReply,
          ].join("\n");

    const reply = await complete({ model, system: STE_SYSTEM, prompt: prompt + retryNote, maxTokens: MAX_TOKENS });
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    lastReply = reply.text;

    const parsed = parseSteReply(reply.text);
    if ("text" in parsed) {
      kept = parsed.text;
      lintErrors = lintSte(kept);
    } else {
      // Keep the previous text. The retry note carries the parse error.
      lintErrors = [parsed.error];
    }

    if (lintErrors.length === 0) {
      return { text: kept, attempts: attempt, lintErrors, usage };
    }
  }

  return { text: kept, attempts: 2, lintErrors, usage };
}
