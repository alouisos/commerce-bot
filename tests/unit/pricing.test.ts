import { describe, expect, it } from "vitest";
import { costMicros } from "@/lib/ai/pricing";

describe("costMicros", () => {
  it("prices input and output", () => {
    expect(costMicros("claude-opus-5-5", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(14000);
  });
  it("prices cache tokens", () => {
    expect(costMicros("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10000, cacheWriteTokens: 1000 })).toBe(7000);
  });
  it("throws on unknown model", () => {
    expect(() => costMicros("nope", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow();
  });
});
