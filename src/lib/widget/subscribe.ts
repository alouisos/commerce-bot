import { createHash } from "node:crypto";
import { z } from "zod";
import { canDraftEmail } from "@/lib/email/domain";
import { subscribe } from "@/lib/email/contacts";
import { hit } from "@/lib/usage/rate-limit";
import { sidSchema, WidgetError, type WidgetSite } from "@/lib/widget/guard";

const schema = z.object({
  sid: sidSchema,
  cid: z.string().nullish(),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  language: z.string().regex(/^[a-z]{2}$/),
});

/** Rate-limit records outlive "delete all data", so they hold a hash of the address, never the address. */
const emailKey = (email: string) => createHash("sha256").update(email).digest("base64url").slice(0, 22);

/** Parses, rate-limits and records a visitor's consent. Unknown fields (a client's own wording) are ignored. */
export async function handleSubscribe(site: WidgetSite, body: unknown, ip: string): Promise<void> {
  const input = schema.parse(body);
  // Per visit, per IP, and per address: one person can't be sent a stream of confirmation emails.
  const allowed =
    (await hit(`sub:${site.id}:${input.sid}`, 3, 3600)) &&
    (await hit(`sub:ip:${ip}`, 20, 3600)) &&
    (await hit(`sub:email:${site.id}:${emailKey(input.email)}`, 3, 86400));
  if (!allowed) throw new WidgetError(429, "Too many requests");
  if (!(await canDraftEmail(site, site.account))) throw new WidgetError(403, "Email is not available");
  await subscribe(site, { sid: input.sid, cid: input.cid ?? null, email: input.email, language: input.language });
}
