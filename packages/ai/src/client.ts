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

/**
 * One image for the model: a public URL that Anthropic fetches, or the bytes as base64.
 * A picture from mission_shots has a relative /api/shots/<id> path that Anthropic cannot fetch, so it goes as bytes.
 */
export type CompleteImage = { url: string } | { mediaType: string; data: string };

/** One text completion. Tests inject a fake to avoid the network. */
export type Complete = (request: {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Images that go before the prompt text. The fix agent sends the failure screenshot. */
  images?: CompleteImage[];
}) => Promise<{ text: string; usage: TokenUsage }>;

/** The image types the Messages API reads from base64. */
export const BASE64_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Base64ImageType = (typeof BASE64_IMAGE_TYPES)[number];

/** The image block for one image, or null for base64 data of a type the API does not read. */
export function imageBlock(image: CompleteImage): Anthropic.ImageBlockParam | null {
  if ("url" in image) return { type: "image", source: { type: "url", url: image.url } };
  const mediaType = image.mediaType.toLowerCase().split(";")[0]!.trim();
  if (!(BASE64_IMAGE_TYPES as readonly string[]).includes(mediaType)) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType as Base64ImageType, data: image.data } };
}

/** Calls the Messages API once and returns the text of the reply. */
export const completeWithAnthropic: Complete = async ({ model, system, prompt, maxTokens, images = [] }) => {
  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(imageBlock).filter((block): block is Anthropic.ImageBlockParam => block !== null),
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
