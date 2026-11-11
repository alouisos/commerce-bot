import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { allowedPort, safeFetch } from "@/lib/net/safe-connect";
import { isBlockedAddress } from "./ssrf";

export type FetchResult = { status: number; finalUrl: string; contentType: string; body: string };
export type Fetcher = (url: string) => Promise<FetchResult>;

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

function charsetFromContentType(contentType: string): string | null {
  return /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1] ?? null;
}

function charsetFromMeta(bytes: Uint8Array): string | null {
  // Latin-1 view of the first 2 KB is enough to read ASCII meta tags in any ASCII-compatible charset.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  return (
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1] ??
    null
  );
}

function decoder(label: string | null): TextDecoder | null {
  if (!label) return null;
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/** Header charset, else <meta> in the first 2 KB, else UTF-8. Unknown charsets fall through. */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const d =
    decoder(charsetFromContentType(contentType)) ?? decoder(charsetFromMeta(bytes)) ?? new TextDecoder("utf-8");
  return d.decode(bytes);
}

async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.length;
    if (off >= out.length) break;
  }
  return out;
}

const MAX_HOPS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function hostAllowed(url: URL): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isBlockedAddress(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

export function createHttpFetcher(opts: { allowPrivate?: boolean } = {}): Fetcher {
  return async (url) => {
    let current = url;
    try {
      const { env } = await import("@/lib/env");
      const allowPrivate = opts.allowPrivate ?? env.CRAWL_ALLOW_PRIVATE_HOSTS;
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const headers = {
        "user-agent": `ConciergeBot/1.0 (+${env.APP_URL}/bot)`,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      };
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        const u = new URL(current);
        if (
          (u.protocol !== "http:" && u.protocol !== "https:") ||
          (!allowPrivate && (!allowedPort(u) || !(await hostAllowed(u))))
        ) {
          return { status: 0, finalUrl: current, contentType: "", body: "" };
        }
        // Guarded requests re-check the address in the socket's own lookup (no DNS-rebinding window).
        const res = allowPrivate
          ? await fetch(current, { redirect: "manual", signal, headers })
          : await safeFetch(current, { redirect: "manual", signal, headers });
        const location = res.headers.get("location");
        if (REDIRECTS.has(res.status) && location) {
          await res.body?.cancel().catch(() => {});
          current = new URL(location, current).href;
          continue;
        }
        const contentType = res.headers.get("content-type") ?? "";
        const isText = /html|xml|text\//i.test(contentType) || contentType === "";
        const body = isText ? decodeBody(await readCapped(res), contentType) : (await res.body?.cancel(), "");
        return { status: res.status, finalUrl: current, contentType, body };
      }
      return { status: 0, finalUrl: current, contentType: "", body: "" };
    } catch {
      return { status: 0, finalUrl: current, contentType: "", body: "" };
    }
  };
}
