import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getAnthropic } from "@/lib/ai/anthropic";
import { meteredModel, type TokenUsage } from "@/lib/ai/pricing";
import { env } from "@/lib/env";

export type ModelRequest = {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  context: string;
};

export type ModelReply = {
  textStream: AsyncIterable<string>;
  done: Promise<{ text: string; model: string; usage: TokenUsage }>;
};

export class ModelRefusalError extends Error {
  constructor() {
    super("The model declined to answer");
    this.name = "ModelRefusalError";
  }
}

/**
 * Text-only history plus the visitor's message, as strictly alternating turns
 * starting with `user` (empty turns dropped, same-role neighbours merged), then
 * the per-message context as the last entry: a mid-conversation system message.
 */
export function buildMessages(req: ModelRequest): BetaMessageParam[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of [...req.history, { role: "user" as const, content: req.message }]) {
    const content = m.content.trim();
    if (!content) continue;
    const last = turns.at(-1);
    if (last?.role === m.role) last.content += `\n\n${content}`;
    else if (last || m.role === "user") turns.push({ role: m.role, content });
  }
  return [...turns, { role: "system", content: req.context }];
}

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeReply(req: ModelRequest): ModelReply {
  const chunks = ["Test reply about: ", req.message.slice(0, 40), "."];
  async function* textStream() {
    yield* chunks;
  }
  return { textStream: textStream(), done: Promise.resolve({ text: chunks.join(""), model: env.CHAT_MODEL, usage: ZERO }) };
}

export function streamModelReply(req: ModelRequest): ModelReply {
  if (env.FAKE_MODEL) return fakeReply(req);
  const model = env.CHAT_MODEL;
  const stream = getAnthropic().beta.messages.stream({
    model,
    max_tokens: 8000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: buildMessages(req),
  });

  async function* textStream() {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
    }
  }

  const done = (async () => {
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new ModelRefusalError();
    // After a mid-stream server-side fallback the partial text stays and the
    // fallback model continues it, so joining the text blocks matches what streamed.
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      text,
      model: meteredModel(msg.model, model),
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      },
    };
  })();
  // A consumer that bails on a stream error never awaits `done`; don't let it become an unhandled rejection.
  done.catch(() => {});
  return { textStream: textStream(), done };
}
