import { z, ZodError } from "zod";
import type { Account, Site } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getSiteByPublicKey, isOriginAllowed } from "@/lib/sites";

export class WidgetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WidgetError";
  }
}

export type WidgetSite = Site & { account: Account };

/** The widget's per-visit session id (random, from sessionStorage); shared by every widget endpoint. */
export const sidSchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

export async function resolveWidgetRequest(
  req: Request,
  key: string | null,
): Promise<{ site: WidgetSite; origin: string }> {
  const site = key ? await getSiteByPublicKey(key) : null;
  if (!site) throw new WidgetError(404, "Unknown site key");
  const origin = req.headers.get("Origin");
  if (!origin || !isOriginAllowed(site, origin)) throw new WidgetError(403, "Origin not allowed");
  return { site, origin };
}

export function corsHeaders(origin: string): Headers {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

export function clientIp(req: Request): string {
  const first = req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return first || "unknown";
}

export function json(body: unknown, status: number, origin?: string | null, extra?: HeadersInit): Response {
  const headers = origin ? corsHeaders(origin) : new Headers();
  headers.set("Content-Type", "application/json");
  new Headers(extra).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(body), { status, headers });
}

/** Origin to echo on error responses: only when the key resolves and the origin is allowed. */
async function allowedOriginFor(req: Request): Promise<string | null> {
  try {
    const origin = req.headers.get("Origin");
    if (!origin) return null;
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const site = key ? await getSiteByPublicKey(key) : null;
    return site && isOriginAllowed(site, origin) ? origin : null;
  } catch {
    return null;
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;
type Wrapped<C> = (req: Request, ctx?: C) => Promise<Response>;

export function withWidgetErrors<C = unknown>(handler: Handler<C>): Wrapped<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx as C);
    } catch (err) {
      const origin = await allowedOriginFor(req);
      if (err instanceof WidgetError) return json({ error: err.message }, err.status, origin);
      if (err instanceof ValidationError) return json({ error: err.message }, 400, origin);
      if (err instanceof ZodError) return json({ error: "Invalid request" }, 400, origin);
      if (err instanceof NotFoundError) return json({ error: err.message }, 404, origin);
      console.error("widget route error", err);
      return json({ error: "Internal error" }, 500, origin);
    }
  };
}

/** OPTIONS handler shared by widget routes; the key comes from the query string. */
export async function preflight(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get("key");
  try {
    const { origin } = await resolveWidgetRequest(req, key);
    const headers = corsHeaders(origin);
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  } catch (err) {
    if (err instanceof WidgetError) return new Response(null, { status: 403 });
    throw err;
  }
}
