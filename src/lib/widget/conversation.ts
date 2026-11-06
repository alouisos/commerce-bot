import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, kbSources, messages } from "@/db/schema";
import { appBaseUrl } from "@/lib/widget/config";
import type { StoredMessage, WidgetImage } from "@/shared/widget-protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Conversation id if it belongs to this site and visitor session, else null. */
export async function findOwnedConversation(siteId: string, sid: string, cid: string | null): Promise<string | null> {
  if (!isUuid(cid)) return null;
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, cid), eq(conversations.siteId, siteId), eq(conversations.visitorSessionId, sid)));
  return row?.id ?? null;
}

export async function loadImages(siteId: string, key: string, ids: string[]): Promise<Map<string, WidgetImage>> {
  const valid = [...new Set(ids.filter(isUuid))];
  const out = new Map<string, WidgetImage>();
  if (valid.length === 0) return out;
  const rows = await db
    .select()
    .from(kbSources)
    .where(and(eq(kbSources.siteId, siteId), eq(kbSources.kind, "image"), inArray(kbSources.id, valid)));
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      url: `${appBaseUrl()}/api/widget/image/${r.id}?key=${encodeURIComponent(key)}`,
      caption: r.caption ?? r.title,
    });
  }
  return out;
}

export async function getStoredMessages(siteId: string, key: string, conversationId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  const images = await loadImages(siteId, key, rows.flatMap((r) => r.imageIds));
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    images: r.imageIds.map((id) => images.get(id)).filter((i): i is WidgetImage => !!i),
    kind: r.kind,
  }));
}
