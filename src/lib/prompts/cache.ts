import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { promptCache } from "@/db/schema";

/**
 * Forgets the site's written suggestions, so the next ones reflect new knowledge or rules.
 * Called when knowledge is learned, removed or excluded, and when settings (guardrails) are saved.
 */
export async function clearPromptCache(siteId: string): Promise<void> {
  await db.delete(promptCache).where(eq(promptCache.siteId, siteId));
}
