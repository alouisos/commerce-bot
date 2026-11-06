import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ CHAT_MODEL: "claude-opus-5-5", FAKE_MODEL: false }));
vi.mock("@/lib/env", () => ({ env }));
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/anthropic", () => ({ getAnthropic: () => ({ beta: { messages: { create } } }) }));

import { describeImage } from "@/lib/ai/describe-image";

const bytes = new Uint8Array([1, 2, 3]);

const withRealModel = <T,>(fn: () => Promise<T>) => fn();

describe("describeImage request", () => {
  afterEach(() => create.mockReset());

  it("sends the expected request and maps usage", async () => {
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ caption: "C", description: "D" }) }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: 2 },
    });
    const out = await withRealModel(() => describeImage({ bytes, mimeType: "image/png", caption: "Mine" }));
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe(env.CHAT_MODEL);
    expect(arg.max_tokens).toBe(16000);
    expect(arg.betas).toContain("server-side-fallback-2026-07-01");
    expect(arg.fallbacks).toBe("default");
    expect(arg.output_config.effort).toBe("medium");
    expect(arg.output_config.format.type).toBe("json_schema");
    expect(Object.keys(arg.output_config.format.schema.properties).sort()).toEqual(["caption", "description"]);
    expect(arg.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: Buffer.from(bytes).toString("base64") },
    });
    expect(arg.messages[0].content[1].type).toBe("text");
    expect(arg.messages[0].content[1].text).toContain(`"Mine"`);
    for (const k of ["temperature", "top_p", "top_k"]) expect(arg).not.toHaveProperty(k);
    expect(out).toMatchObject({
      caption: "C",
      description: "D",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 2 },
    });
  });

  it("throws on refusal", async () => {
    create.mockResolvedValue({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } });
    await expect(withRealModel(() => describeImage({ bytes, mimeType: "image/png" }))).rejects.toThrow();
  });
});
