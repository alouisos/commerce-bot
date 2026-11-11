import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, memberships, sites, siteInsights, user } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/widget/config";
import { WINDOW_MS, type InsightsContent } from "./prompt";

export const INSIGHTS_EMAIL_SUBJECT = "Milian Jo: what visitors asked in the last 24 hours";

type Message = { to: string; subject: string; text: string; headers?: Record<string, string> };
type Send = (m: Message) => Promise<void>;

export const insightsOffUrl = (token: string) => `${appBaseUrl()}/e/i/${encodeURIComponent(token)}`;

function section(title: string, lines: string[]): string[] {
  return lines.length ? ["", `${title}:`, ...lines.map((l) => `- ${l}`)] : [];
}

function bodyText(site: { id: string; name: string }, content: InsightsContent, token: string): string {
  const base = `${appBaseUrl()}/app/sites/${site.id}`;
  return [
    `What visitors asked ${site.name} in the last 24 hours`,
    "",
    content.summary,
    ...section("What people ask most", content.topQuestions.map((q) => `${q.topic}: ${q.detail}`)),
    ...section("Questions the bot couldn't answer well", content.knowledgeGaps.map((g) => `${g.question} ${g.suggestion}`)),
    ...section("Worries before buying", content.objections.map((o) => `${o.concern}: ${o.detail}`)),
    ...section("Products people are curious about", content.curiousProducts.map((p) => `${p.product}: ${p.note}`)),
    "",
    `See the full insights: ${base}/overview?insights=24h`,
    `Ask your own questions about your conversations: ${base}/ask`,
    "",
    "Written by AI from your conversations; check before acting on it.",
    `Turn off this daily email: ${insightsOffUrl(token)}`,
  ].join("\n");
}

/**
 * Emails each opted-in team member of every live site that has a 24-hour insight from the last day.
 * One member's failed send doesn't stop the others. Returns how many emails went out.
 */
export async function sendDailyInsightEmails(now: Date = new Date(), send: Send = sendEmail): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_MS["24h"]);
  const rows = await db
    .select({ siteId: sites.id, siteName: sites.name, accountId: sites.accountId, content: siteInsights.content })
    .from(siteInsights)
    .innerJoin(sites, eq(sites.id, siteInsights.siteId))
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(and(eq(siteInsights.window, "24h"), gte(siteInsights.createdAt, since), isNull(accounts.removedAt)))
    .orderBy(desc(siteInsights.createdAt));
  const seen = new Set<string>();
  let sent = 0;
  for (const r of rows) {
    if (seen.has(r.siteId)) continue; // newest insight per site
    seen.add(r.siteId);
    const members = await db
      .select({ email: user.email, token: memberships.insightsToken })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.accountId, r.accountId), eq(memberships.insightsEmail, true)));
    for (const m of members) {
      if (!m.token) continue;
      try {
        await send({
          to: m.email,
          subject: INSIGHTS_EMAIL_SUBJECT,
          text: bodyText({ id: r.siteId, name: r.siteName }, r.content, m.token),
          headers: {
            "List-Unsubscribe": `<${insightsOffUrl(m.token)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        sent++;
      } catch (err) {
        console.error(`[insights-email] send failed for site ${r.siteId}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return sent;
}

/** Turns the daily insights email on or off for one member. */
export async function setInsightsEmail(userId: string, accountId: string, on: boolean): Promise<void> {
  await db
    .update(memberships)
    .set({ insightsEmail: on })
    .where(and(eq(memberships.userId, userId), eq(memberships.accountId, accountId)));
}

/** Turns the email off for the member behind a link's token; false for an unknown token. */
export async function turnOffInsightsEmail(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const rows = await db
    .update(memberships)
    .set({ insightsEmail: false })
    .where(eq(memberships.insightsToken, token))
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** Whether the member currently gets the email. */
export async function insightsEmailOn(userId: string, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: memberships.insightsEmail })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.accountId, accountId)));
  return row?.on ?? false;
}
