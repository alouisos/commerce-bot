// Runs in a worker thread with a memory limit (see extract.ts), so a crafted file can't take the
// whole worker process down. Plain JS: it's loaded directly by node, not through the TS toolchain.
import { parentPort, workerData } from "node:worker_threads";

const MAX_PDF_PAGES = 500;

async function run() {
  const { kind, bytes } = workerData;
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PDF_PAGES) return { error: `This PDF has more than ${MAX_PDF_PAGES} pages. Split it into smaller files.` };
    const { text } = await extractText(pdf, { mergePages: true });
    return { text };
  }
  if (kind === "docx") {
    const { default: mammoth } = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: value };
  }
  return { error: "Unsupported file type" };
}

run().then(
  (out) => parentPort.postMessage(out),
  () => parentPort.postMessage({ error: "This file couldn't be read." }),
);
