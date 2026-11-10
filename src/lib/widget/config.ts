import { createHash } from "node:crypto";
import { eq, or, isNull, lt, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { siteGreetings, sites, type Account, type Site } from "@/db/schema";
import { COPY, copyFor, fillSite } from "@/lib/copy/defaults";
import { canDraftEmail } from "@/lib/email/domain";
import { atConversationLimit } from "@/lib/usage/levels";
import { env } from "@/lib/env";
import { planStatus } from "@/lib/plans";
import { pausedKinds } from "@/lib/prompts/backoff";
import { aiBlocked, getQuota } from "@/lib/usage/meter";
import { resolveLanguage } from "@/lib/widget/language";
import type { WidgetConfig, WidgetStrings } from "@/shared/widget-protocol";

export { resolveLanguage };

export function appBaseUrl(): string {
  return env.APP_URL.replace(/\/+$/, "");
}

export function greetingImageVersion(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export async function touchLastSeen(siteId: string): Promise<void> {
  await db
    .update(sites)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(eq(sites.id, siteId), or(isNull(sites.lastSeenAt), lt(sites.lastSeenAt, sql`now() - interval '1 minute'`))),
    );
}

/** Languages the widget can speak for a site: built-in copy plus any language with a custom greeting. */
export function availableLanguages(greetings: { language: string }[]): string[] {
  return [...new Set([...Object.keys(COPY), ...greetings.map((g) => g.language.toLowerCase())])];
}

export async function siteLanguages(siteId: string): Promise<string[]> {
  const greetings = await db
    .select({ language: siteGreetings.language })
    .from(siteGreetings)
    .where(eq(siteGreetings.siteId, siteId));
  return availableLanguages(greetings);
}

export async function buildWidgetConfig(
  site: Site & { account: Account },
  requestedLang: string | null,
  now: Date = new Date(),
): Promise<WidgetConfig> {
  const greetings = await db.select().from(siteGreetings).where(eq(siteGreetings.siteId, site.id));
  const language = resolveLanguage(requestedLang, availableLanguages(greetings), site.defaultLanguage);
  const copy = copyFor(language);
  const { defaultGreeting, ...strings } = copy;

  const status = planStatus(site.account, now);
  const quota = await getQuota(site.account, now);
  const mode = aiBlocked(quota) ? "fallback" : "ai";

  const message = greetings.find((g) => g.language.toLowerCase() === language)?.message ?? defaultGreeting;
  const imageUrl = site.greetingImageKey
    ? `${appBaseUrl()}/api/widget/greeting-image?key=${encodeURIComponent(site.publicKey)}&v=${greetingImageVersion(site.greetingImageKey)}`
    : null;

  // This month's conversations are used up: keep answering, but no suggestions. (Email offers follow
  // canDraftEmail, which also stops when the emails are used up.)
  const proactivity = (await atConversationLimit(site.account, now)) ? "off" : site.proactivity;
  return {
    botName: site.botName,
    accentColor: site.accentColor,
    corner: site.corner,
    language,
    greeting: { message, imageUrl },
    strings: { ...(strings as WidgetStrings), consentFine: fillSite(strings.consentFine, site.name) },
    showBadge: !status.limits.removeBadge,
    mode,
    proactivity,
    pausedKinds: proactivity === "off" ? [] : await pausedKinds(site.id, now),
    emailCapture: await canDraftEmail(site, site.account, now),
    consentMode: site.consentMode,
  };
}
