import { describe, expect, it } from "vitest";
import { parseSSE } from "../src/sse";
import type { ChatEvent } from "../../src/shared/widget-protocol";

function stream(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>) {
  const out: ChatEvent[] = [];
  for await (const e of parseSSE(s)) out.push(e);
  return out;
}

describe("parseSSE", () => {
  it("parses events split across chunks", async () => {
    const full = 'data: {"type":"start","cid":"c1"}\n\ndata: {"type":"delta","text":"héllo"}\n\n';
    const cut = [full.slice(0, 10), full.slice(10, 50), full.slice(50)];
    expect(await collect(stream(cut))).toEqual([
      { type: "start", cid: "c1" },
      { type: "delta", text: "héllo" },
    ]);
  });

  it("parses two events in one chunk", async () => {
    const one = 'data: {"type":"delta","text":"a"}\n\ndata: {"type":"delta","text":"b"}\n\n';
    expect((await collect(stream([one]))).length).toBe(2);
  });

  it("splits multibyte characters across byte chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"delta","text":"é"}\n\n');
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    });
    expect(await collect(s)).toEqual([{ type: "delta", text: "é" }]);
  });

  it("skips malformed events", async () => {
    expect(await collect(stream(['data: nope\n\ndata: {"type":"delta","text":"ok"}\n\n']))).toEqual([
      { type: "delta", text: "ok" },
    ]);
  });
});
