import { describe, expect, it } from "vitest";
import { costMicros, meteredModel, PRICED_MODELS } from "@/lib/ai/pricing";

const u = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
});

describe("costMicros", () => {
  it("prices input and output", () => {
    expect(costMicros("claude-opus-5-5", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(14000);
  });
  it("prices cache tokens", () => {
    expect(costMicros("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10000, cacheWriteTokens: 1000 })).toBe(7000);
  });
  it("prices claude-sonnet-5-5", () => {
    // 1000 * 2.00 + 500 * 10.00
    expect(costMicros("claude-sonnet-5-5", u(1000, 500))).toBe(7000);
    // 10000 * 0.20 + 1000 * 2.50
    expect(costMicros("claude-sonnet-5-5", u(0, 0, 10000, 1000))).toBe(4500);
  });
  it("prices claude-haiku-5-5", () => {
    // 1000 * 0.10 + 500 * 0.50
    expect(costMicros("claude-haiku-5-5", u(1000, 500))).toBe(350);
    // 10000 * 0.01 + 1000 * 0.125
    expect(costMicros("claude-haiku-5-5", u(0, 0, 10000, 1000))).toBe(225);
  });
  it("throws on unknown model", () => {
    expect(() => costMicros("nope", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow();
  });
});

describe("priced models", () => {
  it("lists every priced model id", () => {
    expect([...PRICED_MODELS].sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });
  it("meteredModel uses the response model when priced, else the configured one", () => {
    expect(meteredModel("claude-sonnet-5-5", "claude-opus-5-5")).toBe("claude-sonnet-5-5");
    expect(meteredModel("claude-unknown-9", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(meteredModel(undefined, "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
});
