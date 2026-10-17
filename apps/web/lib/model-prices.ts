// List prices for a token cost comparison on the run page.
// USD per 1M tokens, standard tier (no batch, cache or priority discount).
import type { Mission } from "@/lib/app-types";

export type ModelPrice = {
  provider: "Anthropic" | "OpenAI" | "Google";
  model: string;
  modelId: string;
  tier: "frontier" | "cheap";
  inputPerMTok: number;
  outputPerMTok: number;
  note?: string;
};

export const PRICES_AS_OF = "17 Oct 2026";

export const MODEL_PRICES: ModelPrice[] = [
  {
    provider: "Anthropic",
    model: "Claude Opus 5.5",
    modelId: "claude-opus-5-5",
    tier: "frontier",
    inputPerMTok: 4,
    outputPerMTok: 20,
  },
  {
    provider: "Anthropic",
    model: "Claude Haiku 5.5",
    modelId: "claude-haiku-5-5",
    tier: "cheap",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    note: "Prompts up to 100K tokens.",
  },
  {
    provider: "OpenAI",
    model: "GPT-6 Astra",
    modelId: "gpt-6-astra",
    tier: "frontier",
    inputPerMTok: 10,
    outputPerMTok: 50,
  },
  {
    provider: "OpenAI",
    model: "GPT-6 Luna",
    modelId: "gpt-6-luna",
    tier: "cheap",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
  },
  {
    provider: "Google",
    model: "Gemini 4 Argon",
    modelId: "gemini-4-argon",
    tier: "frontier",
    inputPerMTok: 2,
    outputPerMTok: 10,
    note: "Introductory price to 30 Nov 2026. Then $4 / $20.",
  },
  {
    provider: "Google",
    model: "Gemini 3.5 Flash-Lite",
    modelId: "gemini-3.5-flash-lite",
    tier: "cheap",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
  },
];

export const PRICE_SOURCES: {
  provider: ModelPrice["provider"];
  url: string;
}[] = [
  {
    provider: "Anthropic",
    url: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  {
    provider: "OpenAI",
    url: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "Google",
    url: "https://ai.google.dev/gemini-api/docs/pricing",
  },
];

export type TokenUsage = { input: number; output: number; estimate: boolean };

// Estimate of the tokens in one PR run, by step. We use it when no mission
// has recorded usage yet.
//   Planner:      reads the PR diff and repo context, writes 10 missions.
//   Missions:     10 browser missions at about 40,000 in / 2,500 out each
//                 (screenshots, page state and tool calls).
//   STE rewrite:  rewrites the findings in Simplified Technical English.
//   Fix:          drafts a code fix for a confirmed bug.
// Total: 469,000 input tokens and 31,000 output tokens.
export const ESTIMATE_PARTS: {
  part: string;
  input: number;
  output: number;
}[] = [
  { part: "Planner", input: 15_000, output: 3_000 },
  { part: "10 missions (40,000 / 2,500 each)", input: 400_000, output: 25_000 },
  { part: "STE rewrite", input: 4_000, output: 1_000 },
  { part: "Fix", input: 50_000, output: 2_000 },
];

export const ESTIMATE_TOTAL: TokenUsage = ESTIMATE_PARTS.reduce<TokenUsage>(
  (sum, p) => ({
    input: sum.input + p.input,
    output: sum.output + p.output,
    estimate: true,
  }),
  { input: 0, output: 0, estimate: true },
);

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

// Reads one missions.usage value. Accepts the Anthropic shape
// (input_tokens / output_tokens), the shape in packages/ai
// (inputTokens / outputTokens) and a short shape (input / output).
function readUsage(u: unknown): { input: number; output: number } | undefined {
  if (!u || typeof u !== "object") return undefined;
  const o = u as Record<string, unknown>;
  const input = num(o.input_tokens) ?? num(o.inputTokens) ?? num(o.input);
  const output = num(o.output_tokens) ?? num(o.outputTokens) ?? num(o.output);
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0 };
}

// Sums the recorded usage of all missions. When no mission has usage,
// returns the estimate for one PR run.
export function usageFromMissions(missions: Mission[]): TokenUsage {
  let input = 0;
  let output = 0;
  let found = false;
  for (const m of missions) {
    const u = readUsage(m.usage);
    if (!u) continue;
    found = true;
    input += u.input;
    output += u.output;
  }
  if (!found) return { ...ESTIMATE_TOTAL };
  return { input, output, estimate: false };
}

// Cost in USD of the given tokens at one model's list price.
export function costAt(price: ModelPrice, usage: TokenUsage): number {
  return (
    (usage.input / 1_000_000) * price.inputPerMTok +
    (usage.output / 1_000_000) * price.outputPerMTok
  );
}
