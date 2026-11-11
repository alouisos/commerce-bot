"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";
import { parseInsightWindow, type InsightWindow } from "@/lib/insights/prompt";
import { setInsightsEmail } from "@/lib/insights/email";
import { enqueueInsights, lastInsightsAttempt } from "@/lib/insights/schedule";
import { requireUser } from "@/lib/session";

const REFRESH_GAP_MS = 60 * 60 * 1000;

export type RefreshResult = { ok: true } | { ok: false; error: string };

/** Queues fresh insights for one window of the site, at most once an hour. */
export async function refreshInsightsAction(siteId: string, window: InsightWindow): Promise<RefreshResult> {
  if (!parseInsightWindow(window)) return { ok: false, error: "Unknown insights window." };
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  // Counts failed runs too: each one called the model and was metered.
  const last = await lastInsightsAttempt(site.id);
  if (last && Date.now() - last.getTime() < REFRESH_GAP_MS) {
    return { ok: false, error: "Insights were refreshed less than an hour ago." };
  }
  await enqueueInsights(site.id, window);
  revalidatePath(`/app/sites/${site.id}/overview`);
  return { ok: true };
}

/** Turns the daily insights email on or off for the signed-in member. */
export async function setInsightsEmailAction(siteId: string, on: boolean): Promise<void> {
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  await setInsightsEmail(user.id, site.accountId, on);
  revalidatePath(`/app/sites/${site.id}/overview`);
}
