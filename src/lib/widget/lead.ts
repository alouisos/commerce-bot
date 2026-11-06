import { z } from "zod";
import { db } from "@/db/client";
import { leads } from "@/db/schema";
import { LIMITS } from "@/shared/widget-protocol";
import { hit } from "@/lib/usage/rate-limit";
import { findOwnedConversation } from "@/lib/widget/conversation";
import { WidgetError, type WidgetSite } from "@/lib/widget/guard";

const schema = z.object({
  sid: z.string().min(1).max(200),
  cid: z.string().nullish(),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  message: z.string().trim().min(1).max(LIMITS.messageMaxChars),
});

export async function createLead(site: WidgetSite, body: unknown): Promise<void> {
  const input = schema.parse(body);
  if (!(await hit(`lead:${site.id}:${input.sid}`, 5, 3600))) throw new WidgetError(429, "Too many requests");
  const conversationId = await findOwnedConversation(site.id, input.sid, input.cid ?? null);
  await db.insert(leads).values({
    siteId: site.id,
    conversationId,
    email: input.email,
    message: input.message,
    source: "fallback",
  });
}
