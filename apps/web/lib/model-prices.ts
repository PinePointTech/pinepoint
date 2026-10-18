// List prices for a token cost comparison on the run page.
// USD per 1M tokens, standard tier (no batch or priority discount), with each
// provider's cache write and cache hit rates.
import type { Mission } from "@/lib/app-types";

export type ModelPrice = {
  provider: "Anthropic" | "OpenAI" | "Google";
  model: string;
  modelId: string;
  tier: "frontier" | "cheap";
  inputPerMTok: number;
  /** Writing a prompt to the cache. Equal to input when the provider caches for free. */
  cacheWritePerMTok: number;
  /** Reading a cached prompt (a cache hit). */
  cacheReadPerMTok: number;
  outputPerMTok: number;
  note?: string;
};

export const PRICES_AS_OF = "18 Oct 2026";

export const MODEL_PRICES: ModelPrice[] = [
  {
    provider: "Anthropic",
    model: "Claude Opus 5.5",
    modelId: "claude-opus-5-5",
    tier: "frontier",
    inputPerMTok: 4,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 20,
  },
  {
    provider: "Anthropic",
    model: "Claude Haiku 5.5",
    modelId: "claude-haiku-5-5",
    tier: "cheap",
    inputPerMTok: 0.1,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
    outputPerMTok: 0.5,
    note: "Prompts up to 100K tokens.",
  },
  {
    provider: "OpenAI",
    model: "GPT-6 Astra",
    modelId: "gpt-6-astra",
    tier: "frontier",
    inputPerMTok: 10,
    cacheWritePerMTok: 12.5,
    cacheReadPerMTok: 1,
    outputPerMTok: 50,
  },
  {
    provider: "OpenAI",
    model: "GPT-6 Luna",
    modelId: "gpt-6-luna",
    tier: "cheap",
    inputPerMTok: 0.1,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
    outputPerMTok: 0.5,
  },
  {
    provider: "Google",
    model: "Gemini 4 Argon",
    modelId: "gemini-4-argon",
    tier: "frontier",
    inputPerMTok: 2,
    cacheWritePerMTok: 2,
    cacheReadPerMTok: 0.1,
    outputPerMTok: 10,
    note: "Introductory price to 30 Nov 2026. Then $4 / $20, cache hits $0.20. Caching is implicit, so a cache write costs the input price.",
  },
  {
    provider: "Google",
    model: "Gemini 3.5 Flash-Lite",
    modelId: "gemini-3.5-flash-lite",
    tier: "cheap",
    inputPerMTok: 0.3,
    cacheWritePerMTok: 0.3,
    cacheReadPerMTok: 0.03,
    outputPerMTok: 2.5,
    note: "A cache write is priced at the input price. Explicit caching also charges storage per hour.",
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

export type TokenUsage = {
  /** Input tokens that were not read from or written to the cache. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** What Pine charged for these turns at the project's rates. Null when Pine did not price them. */
  pineCost: number | null;
  /** How many missions reported usage. */
  missions: number;
  /** True when no mission reported usage and the numbers come from MEASURED_PER_MISSION. */
  estimate: boolean;
};

/**
 * The average Pine usage of one mission, measured on 60 real missions (5 runs on PRs #10 and #11,
 * 17 and 18 Oct 2026). Used only when a run has no recorded usage yet. Pine priced the LLM part at
 * $0.0124 a mission on average and did not price the Computer time.
 */
export const MEASURED_PER_MISSION = {
  input: 26,
  cacheRead: 137_642,
  cacheWrite: 20_491,
  output: 2_044,
  pineCost: 0.0124,
  sample: 60,
};

/** Preview missions in one run. Flake and production re-runs add a few more. */
const MISSIONS_PER_RUN = 10;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

type MissionUsage = Omit<TokenUsage, "missions" | "estimate">;

// Reads one missions.usage value. The runner saves Pine's AgentUsage:
// { llm: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens },
//   cost: { total, llm, compute, currency } }.
// A flat { inputTokens, outputTokens } (packages/ai) or { input_tokens, output_tokens } also reads.
export function readUsage(u: unknown): MissionUsage | undefined {
  const o = obj(u);
  if (!o) return undefined;
  const llm = obj(o.llm) ?? o;
  const input = num(llm.inputTokens) ?? num(llm.input_tokens);
  const output = num(llm.outputTokens) ?? num(llm.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  const cost = obj(o.cost);
  return {
    input: input ?? 0,
    cacheRead: num(llm.cacheReadTokens) ?? num(llm.cache_read_input_tokens) ?? 0,
    cacheWrite: num(llm.cacheWriteTokens) ?? num(llm.cache_creation_input_tokens) ?? 0,
    output: output ?? 0,
    pineCost: cost ? (num(cost.total) ?? null) : null,
  };
}

// Sums the recorded usage of all missions. When no mission has usage, returns
// the measured average of one mission times 10, marked as an estimate.
export function usageFromMissions(missions: Mission[]): TokenUsage {
  const sum: TokenUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, pineCost: null, missions: 0, estimate: false };
  for (const m of missions) {
    const u = readUsage(m.usage);
    if (!u) continue;
    sum.missions += 1;
    sum.input += u.input;
    sum.cacheRead += u.cacheRead;
    sum.cacheWrite += u.cacheWrite;
    sum.output += u.output;
    if (u.pineCost !== null) sum.pineCost = (sum.pineCost ?? 0) + u.pineCost;
  }
  if (sum.missions > 0) return sum;
  const m = MEASURED_PER_MISSION;
  return {
    input: m.input * MISSIONS_PER_RUN,
    cacheRead: m.cacheRead * MISSIONS_PER_RUN,
    cacheWrite: m.cacheWrite * MISSIONS_PER_RUN,
    output: m.output * MISSIONS_PER_RUN,
    pineCost: m.pineCost * MISSIONS_PER_RUN,
    missions: 0,
    estimate: true,
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.cacheRead + u.cacheWrite + u.output;
}

// Cost in USD of the given tokens at one model's list price, cache rates included.
export function costAt(price: ModelPrice, usage: TokenUsage): number {
  return (
    (usage.input * price.inputPerMTok +
      usage.cacheWrite * price.cacheWritePerMTok +
      usage.cacheRead * price.cacheReadPerMTok +
      usage.output * price.outputPerMTok) /
    1_000_000
  );
}
