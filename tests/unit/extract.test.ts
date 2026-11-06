import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/kb/extract";
import { ValidationError } from "@/lib/errors";

const EN = "Argan oil protects colour-treated hair.";
const EL = "Το λάδι αργκάν προστατεύει τα βαμμένα μαλλιά.";
const load = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/kb/${n}`));

describe("extractText", () => {
  for (const [file, mime] of [
    ["sample.pdf", "application/pdf"],
    ["sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sample.md", "text/markdown"],
    ["sample.md", "text/x-markdown"],
    ["sample.md", "text/plain"],
  ] as const) {
    it(`extracts ${file} as ${mime}`, async () => {
      const t = await extractText(load(file), mime);
      expect(t).toContain(EN);
      expect(t).toContain(EL);
    });
  }
  it("normalises whitespace", async () => {
    const t = await extractText(new TextEncoder().encode("  a \t  b  \n\n\n\n c  "), "text/plain");
    expect(t).toBe("a b\n\nc");
  });
  it("rejects unsupported types", async () => {
    await expect(extractText(new Uint8Array([1]), "image/png")).rejects.toBeInstanceOf(ValidationError);
  });
});
