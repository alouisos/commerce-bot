import { z } from "zod";
import { offerPrompt } from "@/lib/prompts/offer";
import { hit } from "@/lib/usage/rate-limit";
import { clientIp, corsHeaders, json, preflight, resolveWidgetRequest, sidSchema, WidgetError, withWidgetErrors } from "@/lib/widget/guard";
import { INTENTS, pageSchema, testKeySchema } from "@/lib/widget/schemas";
import { isValidTestKey } from "@/lib/widget/test-mode";

const schema = z.object({
  sid: sidSchema,
  page: pageSchema,
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  test: testKeySchema,
});

/** Suggestion requests per visit per 30 minutes; the owner's test tab may ask far more often. */
const PER_VISIT = 6;
const PER_VISIT_TEST = 120;

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
  const testMode = isValidTestKey(site.publicKey, input.test);
  if (
    !(await hit(`prompt:sid:${input.sid}`, testMode ? PER_VISIT_TEST : PER_VISIT, 1800)) ||
    !(await hit(`prompt:ip:${clientIp(req)}`, 30, 300)) ||
    !(await hit(`prompt:site:${site.id}`, 300, 300))
  ) {
    throw new WidgetError(429, "Too many requests");
  }
  const offer = await offerPrompt(site, input, { testMode });
  if (!offer) return new Response(null, { status: 204, headers: corsHeaders(origin) });
  return json(offer, 200, origin);
});

export const OPTIONS = preflight;
