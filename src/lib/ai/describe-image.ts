import { getAnthropic } from "@/lib/ai/anthropic";
import type { TokenUsage } from "@/lib/ai/pricing";
import { env } from "@/lib/env";

export function buildPrompt(caption?: string): string {
  const base =
    "Describe this image for a shop's product knowledge base. Transcribe every legible word exactly as printed (product names, labels, ingredient lists, sizes, instructions), in the original language. Then describe what the image shows and how a customer might use that information. Return a short caption (max 12 words) and the full description.";
  return caption ? `${base} The shop owner's caption: "${caption}".` : base;
}

type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export async function describeImage(input: {
  bytes: Uint8Array;
  mimeType: string;
  caption?: string;
}): Promise<{ caption: string; description: string; model: string; usage: TokenUsage }> {
  const model = env.CHAT_MODEL;
  if (env.FAKE_MODEL) {
    return {
      caption: input.caption ?? "Test image",
      description: "Test description",
      model,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
  const res = await getAnthropic().beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { caption: { type: "string" }, description: { type: "string" } },
          required: ["caption", "description"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mimeType as MediaType,
              data: Buffer.from(input.bytes).toString("base64"),
            },
          },
          { type: "text", text: buildPrompt(input.caption) },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to describe this image");
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("The model returned no description");
  const parsed = JSON.parse(block.text) as { caption?: unknown; description?: unknown };
  if (typeof parsed.caption !== "string" || typeof parsed.description !== "string") {
    throw new Error("The model returned an unexpected description");
  }
  return {
    caption: parsed.caption,
    description: parsed.description,
    model,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
