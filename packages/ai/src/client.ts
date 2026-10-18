// The Anthropic client and the model names from the environment (plan section 4.4).
// The client is created on first use so that importing this package never needs the env.

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | undefined;

/** Reads ANTHROPIC_API_KEY. Throws a clear error when it is missing. Never logs the value. */
export function anthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set. Put the Anthropic key in .env.local.");
  }
  return key;
}

/** The model for the planner and the STE rewrite. */
export function plannerModel(): string {
  const model = process.env.PLANNER_MODEL;
  if (!model) {
    throw new Error("PLANNER_MODEL is not set. Put the planner model name in .env.local.");
  }
  return model;
}

/** The model for the fix agent. */
export function fixModel(): string {
  const model = process.env.FIX_MODEL;
  if (!model) {
    throw new Error("FIX_MODEL is not set. Put the fix model name in .env.local.");
  }
  return model;
}

/** The shared Anthropic client. */
export function anthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({ apiKey: anthropicApiKey() });
  }
  return cached;
}

/** Token counts from one call. The run cost comes from these (plan section 11). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** One text completion. Tests inject a fake to avoid the network. */
export type Complete = (request: {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Public image URLs that go before the prompt text. The fix agent sends the failure screenshot. */
  images?: Array<{ url: string }>;
}) => Promise<{ text: string; usage: TokenUsage }>;

/** Calls the Messages API once and returns the text of the reply. */
export const completeWithAnthropic: Complete = async ({ model, system, prompt, maxTokens, images = [] }) => {
  const content: Anthropic.ContentBlockParam[] = [
    ...images.map((image): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "url", url: image.url } })),
    { type: "text", text: prompt },
  ];
  const message = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
  });
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    text,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  };
};
