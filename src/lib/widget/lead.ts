import { z } from "zod";
import { db } from "@/db/client";
import { leads } from "@/db/schema";
import { LIMITS } from "@/shared/widget-protocol";
import { notifyNewLead } from "@/lib/leads";
import { hit } from "@/lib/usage/rate-limit";
import { findOwnedConversation } from "@/lib/widget/conversation";
import { sidSchema, WidgetError, type WidgetSite } from "@/lib/widget/guard";

const schema = z.object({
  sid: sidSchema,
  cid: z.string().nullish(),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  message: z.string().trim().min(1).max(LIMITS.messageMaxChars),
});

export async function createLead(site: WidgetSite, body: unknown, ip: string): Promise<void> {
  const input = schema.parse(body);
  // Per session, plus a per-IP backstop against a client that rotates its sid.
  // Per session, per IP, and per site: each lead emails the owners, so a script can't flood their inbox.
  if (
    !(await hit(`lead:${site.id}:${input.sid}`, 5, 3600)) ||
    !(await hit(`lead:ip:${ip}`, 30, 3600)) ||
    !(await hit(`lead:site:${site.id}`, 50, 3600))
  ) {
    throw new WidgetError(429, "Too many requests");
  }
  const conversationId = await findOwnedConversation(site.id, input.sid, input.cid ?? null);
  await db.insert(leads).values({
    siteId: site.id,
    conversationId,
    email: input.email,
    message: input.message,
    source: "fallback",
  });
  // Not awaited: the visitor's request doesn't wait on email, and a send failure never fails the lead.
  void notifyNewLead(site, input).catch((err) =>
    console.error("lead notification failed", { siteId: site.id }, err),
  );
}
