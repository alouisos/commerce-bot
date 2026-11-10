import { z } from "zod";
import { recordSighting } from "@/lib/sales/record";
import { hit } from "@/lib/usage/rate-limit";
import {
  clientIp,
  corsHeaders,
  preflight,
  resolveWidgetRequest,
  sidSchema,
  WidgetError,
  withWidgetErrors,
} from "@/lib/widget/guard";
import { LIMITS } from "@/shared/widget-protocol";

const schema = z.object({
  sid: sidSchema,
  url: z
    .string()
    .max(LIMITS.urlMaxChars)
    .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), "url"),
  orderId: z.string().regex(/^\d{1,20}$/).nullable(),
  orderKey: z.string().regex(/^wc_order_[A-Za-z0-9]{6,40}$/).nullable(),
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
});

export const POST = withWidgetErrors(async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  const { site, origin } = await resolveWidgetRequest(req, key);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const input = schema.parse(body);
  // Per visit and per IP, plus a per-site ceiling so forged beacons can't make us hammer the shop's API.
  if (
    !(await hit(`order:${site.id}:${input.sid}`, 5, 3600)) ||
    !(await hit(`order:ip:${clientIp(req)}`, 60, 3600)) ||
    !(await hit(`order:site:${site.id}`, 200, 3600))
  ) {
    throw new WidgetError(429, "Too many requests");
  }
  await recordSighting(site, input);
  // Same answer whether or not the purchase was attributed.
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});

export const OPTIONS = preflight;
