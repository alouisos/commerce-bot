import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { promptImpressions } from "@/db/schema";
import { hit } from "@/lib/usage/rate-limit";
import { clientIp, corsHeaders, preflight, resolveWidgetRequest, sidSchema, WidgetError, withWidgetErrors } from "@/lib/widget/guard";

const schema = z.object({
  sid: sidSchema,
  id: z.uuid(),
  event: z.enum(["shown", "tapped", "dismissed"]),
});

/** Records what happened to a suggestion. Only the visit it was offered to can report on it. */
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
  // Per visit and per IP: forged dismissals could otherwise pause a site's suggestions.
  if (!(await hit(`promptev:sid:${input.sid}`, 30, 300)) || !(await hit(`promptev:ip:${clientIp(req)}`, 120, 300))) {
    throw new WidgetError(429, "Too many requests");
  }

  const mine = and(
    eq(promptImpressions.id, input.id),
    eq(promptImpressions.siteId, site.id),
    eq(promptImpressions.visitorSessionId, input.sid),
  );
  const now = new Date();
  if (input.event === "shown") {
    await db.update(promptImpressions).set({ shownAt: now }).where(and(mine, isNull(promptImpressions.shownAt)));
  } else {
    await db
      .update(promptImpressions)
      .set({ outcome: input.event, outcomeAt: now })
      .where(and(mine, isNull(promptImpressions.outcome)));
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});

export const OPTIONS = preflight;
