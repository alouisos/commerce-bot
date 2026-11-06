import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ CHAT_MODEL: "claude-opus-5-5", FAKE_MODEL: false }));
vi.mock("@/lib/env", () => ({ env }));
const stream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/anthropic", () => ({ getAnthropic: () => ({ beta: { messages: { stream } } }) }));

import { buildMessages, streamModelReply, type ModelRequest } from "@/lib/chat/model";

const req: ModelRequest = {
  system: "SYS",
  history: [
    { role: "assistant", content: "Hi! How can I help?" },
    { role: "user", content: "one" },
    { role: "user", content: "two" },
    { role: "assistant", content: "answer" },
    { role: "assistant", content: "" },
    { role: "user", content: "pending" },
  ],
  message: "now",
  context: "CTX",
};

function fakeStream(events: unknown[], final: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: () => Promise.resolve(final),
  };
}

const textDelta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

async function collect(it: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("buildMessages", () => {
  it("alternates roles, starts with user and ends with the system context", () => {
    expect(buildMessages(req)).toEqual([
      { role: "user", content: "one\n\ntwo" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "pending\n\nnow" },
      { role: "system", content: "CTX" },
    ]);
  });
});

describe("streamModelReply", () => {
  afterEach(() => {
    stream.mockReset();
    env.FAKE_MODEL = false;
  });

  it("sends the expected request, streams text and maps usage", async () => {
    stream.mockReturnValue(
      fakeStream(
        [{ type: "message_start" }, textDelta("Hel"), { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "x" } }, textDelta("lo")],
        {
          stop_reason: "end_turn",
          content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello" }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: 7 },
        },
      ),
    );
    const reply = streamModelReply({ ...req, history: [] });
    expect(await collect(reply.textStream)).toEqual(["Hel", "lo"]);
    expect(await reply.done).toEqual({
      text: "Hello",
      model: "claude-opus-5-5",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 7 },
    });
    const arg = stream.mock.calls[0][0];
    expect(arg).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: "now" },
        { role: "system", content: "CTX" },
      ],
    });
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(arg).not.toHaveProperty(k);
  });

  it("rejects done on refusal", async () => {
    stream.mockReturnValue(
      fakeStream([textDelta("par")], { stop_reason: "refusal", content: [{ type: "text", text: "par" }], usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const reply = streamModelReply(req);
    await collect(reply.textStream);
    await expect(reply.done).rejects.toThrow(/declined/);
  });

  it("fake model yields three chunks with zero usage and no network", async () => {
    env.FAKE_MODEL = true;
    const reply = streamModelReply({ ...req, message: "x".repeat(50) });
    expect(await collect(reply.textStream)).toEqual(["Test reply about: ", "x".repeat(40), "."]);
    expect(await reply.done).toEqual({
      text: `Test reply about: ${"x".repeat(40)}.`,
      model: "claude-opus-5-5",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(stream).not.toHaveBeenCalled();
  });
});
