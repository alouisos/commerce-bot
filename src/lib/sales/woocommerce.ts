// The shop's WooCommerce REST API, read with the key the admin pasted. Requests go only to public
// addresses, never follow redirects (the key would go with them), and time out quickly.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedAddress } from "@/lib/crawl/ssrf";
import { env } from "@/lib/env";

export type WooCredentials = { storeUrl: string; consumerKey: string; consumerSecret: string };

export type WooOrder = {
  id: number;
  orderKey: string;
  status: string;
  currency: string;
  total: string | null;
  createdGmt: string;
  billingEmail: string | null;
};

type Transport = { fetch: typeof fetch; lookup: (host: string) => Promise<string[]> };

const realTransport: Transport = {
  fetch: (...args) => fetch(...args),
  lookup: async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address),
};
let transport: Transport = realTransport;

/** Tests swap the fetch and the DNS lookup; null restores the real ones. */
export function setWooTransportForTests(t: Transport | null): void {
  transport = t ?? realTransport;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;

async function publicHost(url: URL): Promise<boolean> {
  if (env.CRAWL_ALLOW_PRIVATE_HOSTS) return true;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isBlockedAddress(host);
  try {
    const addrs = await transport.lookup(host);
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a));
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type WooResponse = { status: number; json: unknown; location: string | null };

/** GET {storeUrl}/wp-json/wc/v3{path}. Status 0 means the request wasn't made or didn't complete. */
export async function wooGet(creds: WooCredentials, path: string): Promise<WooResponse> {
  const base = `${creds.storeUrl.replace(/\/+$/, "")}/wp-json/wc/v3${path}`;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { status: 0, json: null, location: null };
  }
  if (url.protocol !== "https:" && !env.CRAWL_ALLOW_PRIVATE_HOSTS) return { status: 0, json: null, location: null };
  if (!(await publicHost(url))) return { status: 0, json: null, location: null };

  const attempt = async (withQuery: boolean): Promise<WooResponse> => {
    const target = new URL(url);
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "Concierge/1.0" };
    if (withQuery) {
      target.searchParams.set("consumer_key", creds.consumerKey);
      target.searchParams.set("consumer_secret", creds.consumerSecret);
    } else {
      headers.authorization = `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64")}`;
    }
    const res = await transport.fetch(target.href, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, json: null, location };
    }
    let json: unknown = null;
    try {
      json = JSON.parse(await readCapped(res));
    } catch {
      json = null;
    }
    return { status: res.status, json, location: null };
  };

  try {
    const first = await attempt(false);
    // Some hosts strip the Authorization header; WooCommerce also accepts the key as query parameters over HTTPS.
    return first.status === 401 ? await attempt(true) : first;
  } catch {
    return { status: 0, json: null, location: null };
  }
}

function asOrder(v: unknown): WooOrder | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.order_key !== "string" || typeof o.status !== "string") return null;
  if (typeof o.currency !== "string" || typeof o.date_created_gmt !== "string") return null;
  const billing = (o.billing ?? {}) as Record<string, unknown>;
  return {
    id: o.id,
    orderKey: o.order_key,
    status: o.status,
    currency: o.currency.toUpperCase(),
    total: typeof o.total === "string" ? o.total : null,
    createdGmt: o.date_created_gmt,
    billingEmail: typeof billing.email === "string" && billing.email ? billing.email : null,
  };
}

export class WooError extends Error {
  constructor(
    readonly kind: "unauthorized" | "unavailable" | "redirect" | "no-api",
    message: string,
  ) {
    super(message);
    this.name = "WooError";
  }
}

/** The order, or null when the shop says it doesn't exist. Throws WooError when the shop can't be asked. */
export async function fetchOrder(creds: WooCredentials, id: string): Promise<WooOrder | null> {
  if (!/^\d{1,20}$/.test(id)) return null;
  const res = await wooGet(creds, `/orders/${id}`);
  if (res.status === 404) {
    // WooCommerce's own answer for an unknown order; any other 404 means the API itself is gone.
    const code = (res.json as { code?: unknown } | null)?.code;
    if (code === "woocommerce_rest_shop_order_invalid_id") return null;
    throw new WooError("no-api", "Your shop's WooCommerce REST API can't be reached any more. Reconnect WooCommerce.");
  }
  if (res.status >= 300 && res.status < 400) {
    let target = "another address";
    try {
      target = new URL(res.location ?? "", creds.storeUrl).origin;
    } catch {
      // keep the generic wording
    }
    throw new WooError("redirect", `Your shop redirects to ${target}. Reconnect WooCommerce with that address.`);
  }
  if (res.status === 401 || res.status === 403) throw new WooError("unauthorized", "WooCommerce refused the key");
  if (res.status !== 200) throw new WooError("unavailable", `WooCommerce answered ${res.status}`);
  return asOrder(res.json);
}

export async function testConnection(creds: WooCredentials): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await wooGet(creds, "/orders?per_page=1");
  if (res.status === 200 && Array.isArray(res.json)) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, error: "WooCommerce refused the key. Check it has Read access." };
  if (res.status === 404) return { ok: false, error: "There's no WooCommerce REST API at this address." };
  if (res.status >= 300 && res.status < 400 && res.location) {
    try {
      const target = new URL(res.location, creds.storeUrl).origin;
      return { ok: false, error: `Your shop redirects to ${target}. Use that address.` };
    } catch {
      // fall through
    }
  }
  return { ok: false, error: "Couldn't reach your shop. Try again in a minute." };
}
