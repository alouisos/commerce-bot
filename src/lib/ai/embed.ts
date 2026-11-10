import { env } from "@/lib/env";

export interface Embedder {
  readonly dimensions: 1024;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

const DIM = 1024;
const BATCH = 128;
/** Retries for queries (a visitor is waiting) and for 5xx. */
const MAX_RETRIES = 3;
/**
 * Document embedding runs in the worker, so on 429 it waits the limit out instead of failing the
 * page. Rate limits are per minute (an account without a payment method gets 3 requests/minute),
 * so a few seconds of backoff is not enough: wait Retry-After, else 15s, 30s, then 60s per try.
 */
const DOC_RATE_LIMIT_RETRIES = 8;
const DOC_RATE_LIMIT_MAX_WAIT_MS = 65_000;

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic test embedder: hashes lowercase word tokens into 1024 buckets
 * and L2-normalises. Empty text would give a zero vector (which pgvector
 * cosine distance rejects), so it maps to a unit vector in bucket 0.
 */
export const fakeEmbedder: Embedder = {
  dimensions: DIM,
  async embed(texts) {
    return texts.map((text) => {
      const v = new Array<number>(DIM).fill(0);
      for (const tok of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) v[fnv1a(tok) % DIM] += 1;
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      if (norm === 0) {
        v[0] = 1;
        return v;
      }
      return v.map((x) => x / norm);
    });
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function voyageEmbedder(apiKey: string): Embedder {
  async function batch(input: string[], kind: "document" | "query"): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3.5", input, input_type: kind, output_dimension: DIM }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
        return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }
      if (res.status === 429 && kind === "document" && attempt < DOC_RATE_LIMIT_RETRIES) {
        const backoff = 15_000 * 2 ** Math.min(attempt, 2);
        await sleep(Math.min(retryAfterMs(res) ?? backoff, DOC_RATE_LIMIT_MAX_WAIT_MS) + Math.random() * 1000);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`Voyage embeddings failed: ${res.status}`);
    }
  }
  return {
    dimensions: DIM,
    async embed(texts, kind) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) out.push(...(await batch(texts.slice(i, i + BATCH), kind)));
      return out;
    },
  };
}

export function getEmbedder(): Embedder {
  if (env.FAKE_EMBEDDINGS) return fakeEmbedder;
  return voyageEmbedder(env.VOYAGE_API_KEY!);
}
