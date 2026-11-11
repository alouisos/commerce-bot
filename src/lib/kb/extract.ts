import { Worker } from "node:worker_threads";
import JSZip from "jszip";
import { ValidationError } from "@/lib/errors";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** At most this much text is taken from one file (about 1,000 chunks). */
export const MAX_TEXT_CHARS = 1_000_000;
/** A Word file's parts may unpack to at most this much in total. */
const MAX_DOCX_UNPACKED_BYTES = 50 * 1024 * 1024;
const WORKER_HEAP_MB = 512;
const WORKER_TIMEOUT_MS = 60_000;

function normalize(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

function capped(text: string): string {
  const t = normalize(text);
  if (t.length > MAX_TEXT_CHARS) throw new ValidationError("This file has too much text. Split it into smaller files.");
  return t;
}

/** Reads the zip's directory only (sizes as declared), so a zip bomb is refused before anything is unpacked. */
async function checkDocxSize(bytes: Uint8Array): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    throw new ValidationError("This Word file couldn't be read.");
  }
  let total = 0;
  for (const f of Object.values(zip.files)) {
    const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    total += size;
    if (total > MAX_DOCX_UNPACKED_BYTES) throw new ValidationError("This document is too large once unpacked.");
  }
}

/** PDF and Word parsing run in a worker thread with a heap limit and a deadline. */
function inWorker(kind: "pdf" | "docx", bytes: Uint8Array, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./extract-worker.mjs", import.meta.url), {
      workerData: { kind, bytes },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 64 },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ValidationError("This file took too long to read."))), timeoutMs);
    worker.once("message", (out: { text?: string; error?: string }) =>
      finish(() => (out.error !== undefined ? reject(new ValidationError(out.error)) : resolve(out.text ?? ""))),
    );
    worker.once("error", (err: Error & { code?: string }) =>
      finish(() =>
        reject(
          new ValidationError(
            err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "This file is too large to read." : "This file couldn't be read.",
          ),
        ),
      ),
    );
    worker.once("exit", (code) => finish(() => reject(new ValidationError(code === 0 ? "This file couldn't be read." : "This file is too large to read."))));
  });
}

export async function extractText(
  bytes: Uint8Array,
  mimeType: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? WORKER_TIMEOUT_MS;
  switch (mimeType) {
    case "application/pdf":
      return capped(await inWorker("pdf", bytes, timeoutMs));
    case DOCX:
      await checkDocxSize(bytes);
      return capped(await inWorker("docx", bytes, timeoutMs));
    case "text/plain":
    case "text/markdown":
    case "text/x-markdown":
      return capped(new TextDecoder("utf-8").decode(bytes));
    default:
      throw new ValidationError("Unsupported file type");
  }
}
