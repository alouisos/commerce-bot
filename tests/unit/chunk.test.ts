import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/kb/chunk";

describe("chunkText", () => {
  it("handles empty and short input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n ")).toEqual([]);
    expect(chunkText("short text")).toEqual(["short text"]);
  });
  it("respects maxChars and never starts mid-word", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`).join("\n\n");
    const chunks = chunkText(long, { maxChars: 1000, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1000 && c.length > 0 && c === c.trim())).toBe(true);
    for (const c of chunks) {
      const at = long.indexOf(c);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at === 0 || /\s/.test(long[at - 1])).toBe(true);
    }
  });
  it("covers all the text", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here. `.repeat(8)).join("\n\n");
    const chunks = chunkText(long, { maxChars: 500, overlapChars: 50 });
    expect(chunks.join(" ")).toContain("Sentence number 39");
    expect(chunks[0]).toContain("Sentence number 0");
  });
  it("hard-splits a single giant word", () => {
    expect(chunkText("α".repeat(5000), { maxChars: 1000 }).length).toBe(5);
  });
});
