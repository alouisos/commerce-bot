import mammoth from "mammoth";
import { extractText as pdfExtract, getDocumentProxy } from "unpdf";
import { ValidationError } from "@/lib/errors";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function normalize(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await pdfExtract(pdf, { mergePages: true });
      return normalize(text);
    }
    case DOCX: {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return normalize(value);
    }
    case "text/plain":
    case "text/markdown":
    case "text/x-markdown":
      return normalize(new TextDecoder("utf-8").decode(bytes));
    default:
      throw new ValidationError("Unsupported file type");
  }
}
