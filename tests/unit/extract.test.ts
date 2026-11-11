import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractText, MAX_TEXT_CHARS } from "@/lib/kb/extract";
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

  it("refuses a DOCX that unpacks to far more than its size (zip bomb), before parsing it", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", `<w:document><w:body>${"a".repeat(60 * 1024 * 1024)}</w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await expect(extractText(bytes, mime)).rejects.toThrow(new ValidationError("This document is too large once unpacked."));
  });

  it("refuses more text than the knowledge base takes from one file", async () => {
    const big = new TextEncoder().encode("word ".repeat(MAX_TEXT_CHARS / 5 + 10));
    await expect(extractText(big, "text/plain")).rejects.toThrow(
      new ValidationError("This file has too much text. Split it into smaller files."),
    );
  });

  it("reads PDFs and Word files in an isolated, time-limited worker", async () => {
    await expect(extractText(load("sample.pdf"), "application/pdf", { timeoutMs: 1 })).rejects.toThrow(
      new ValidationError("This file took too long to read."),
    );
  });
});
