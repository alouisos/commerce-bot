import type { ChatEvent } from "../../src/shared/widget-protocol";

function parseEvent(raw: string): ChatEvent | null {
  const data = raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const v = JSON.parse(data) as ChatEvent;
    return v && typeof v === "object" && typeof v.type === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const ev = parseEvent(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (ev) yield ev;
      }
    }
    buf += decoder.decode();
    const last = parseEvent(buf);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
