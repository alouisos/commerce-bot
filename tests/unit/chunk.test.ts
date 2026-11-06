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
  it("never cuts tokens like 3.4, www.example.com or e.g.", () => {
    const para = Array.from(
      { length: 12 },
      (_, i) => `Version 3.4 shipped today${i}. See www.example.com for details, e.g. the changelog and notes.`,
    ).join(" ");
    const text = `${para}\n\nShort trailing paragraph.`;
    const chunks = chunkText(text, { maxChars: 300, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(300);
      const at = text.indexOf(c);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at === 0 || /\s/.test(text[at - 1])).toBe(true);
      const end = at + c.length;
      expect(end === text.length || /\s/.test(text[end])).toBe(true);
      expect(c).not.toMatch(/(^|\s)(4 today|com for)/);
    }
    expect(chunks.at(-1)).toContain("Short trailing paragraph.");
  });
  it("overlaps consecutive chunks by at most overlapChars plus a word", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Para ${i} ${"lorem ipsum dolor sit amet ".repeat(5)}`.trim()).join("\n\n");
    const overlapChars = 100;
    const chunks = chunkText(text, { maxChars: 1000, overlapChars });
    expect(chunks.length).toBeGreaterThan(1);
    let from = 0;
    const spans = chunks.map((c) => {
      const at = text.indexOf(c, from);
      from = at + 1;
      return [at, at + c.length] as const;
    });
    for (let n = 0; n + 1 < spans.length; n++) {
      const shared = spans[n][1] - spans[n + 1][0];
      expect(shared).toBeGreaterThan(0);
      expect(shared).toBeLessThanOrEqual(overlapChars + 10);
    }
  });
});
