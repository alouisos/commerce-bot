"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";
import { enqueueInsights, latestInsight } from "@/lib/insights/schedule";
import { requireUser } from "@/lib/session";

const REFRESH_GAP_MS = 60 * 60 * 1000;

export type RefreshResult = { ok: true } | { ok: false; error: string };

/** Queues fresh insights for the site, at most once an hour. */
export async function refreshInsightsAction(siteId: string): Promise<RefreshResult> {
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const latest = await latestInsight(site.id);
  if (latest && Date.now() - latest.createdAt.getTime() < REFRESH_GAP_MS) {
    return { ok: false, error: "Insights were refreshed less than an hour ago." };
  }
  await enqueueInsights(site.id);
  revalidatePath(`/app/sites/${site.id}/overview`);
  return { ok: true };
}
