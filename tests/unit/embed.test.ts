import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { FAKE_EMBEDDINGS: true } }));

import { fakeEmbedder, getEmbedder, voyageEmbedder } from "@/lib/ai/embed";

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe("fake embedder", () => {
  it("returns 1024-length unit vectors, deterministic", async () => {
    const [a, b] = await fakeEmbedder.embed(["Argan oil hair", "Argan oil hair"], "document");
    expect(a).toHaveLength(1024);
    expect(norm(a)).toBeCloseTo(1, 6);
    expect(a).toEqual(b);
  });
  it("shared words score higher", async () => {
    const [q, s, o] = await fakeEmbedder.embed(["argan oil hair", "Argan oil protects hair", "Shipping takes days"], "query");
    expect(dot(q, s)).toBeGreaterThan(dot(q, o));
  });
  it("handles empty text without a zero vector", async () => {
    const [e] = await fakeEmbedder.embed([""], "document");
    expect(norm(e)).toBeCloseTo(1, 6);
  });
  it("getEmbedder returns the fake one in tests", () => {
    expect(getEmbedder()).toBe(fakeEmbedder);
  });
});

describe("voyage embedder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const okResponse = (body: { input: string[] }) =>
    new Response(
      JSON.stringify({
        data: body.input.map((t, i) => ({ index: i, embedding: [Number(t)] })).reverse(),
      }),
      { status: 200 },
    );

  it("batches by 128 and orders by index", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => okResponse(JSON.parse(init.body as string)));
    vi.stubGlobal("fetch", fetchMock);
    const texts = Array.from({ length: 300 }, (_, i) => String(i));
    const out = await voyageEmbedder("key").embed(texts, "document");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out.map((v) => v[0])).toEqual(texts.map(Number));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "voyage-3.5",
      input_type: "document",
      output_dimension: 1024,
    });
  });
  it("retries on 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockImplementationOnce(async (_u: string, init: RequestInit) => okResponse(JSON.parse(init.body as string)));
    vi.stubGlobal("fetch", fetchMock);
    const p = voyageEmbedder("key").embed(["7"], "query");
    await vi.runAllTimersAsync();
    expect(await p).toEqual([[7]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("gives up after 3 retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("err", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = voyageEmbedder("key").embed(["1"], "query");
    const assertion = expect(p).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
