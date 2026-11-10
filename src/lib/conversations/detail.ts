import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, leads, messages, type Conversation, type Lead, type Message } from "@/db/schema";
import { isUuid } from "@/lib/widget/conversation";

/** One conversation of the site with its messages (oldest first) and leads, or null if the site has no such one. */
export async function getConversation(
  siteId: string,
  conversationId: string,
): Promise<{ conversation: Conversation; messages: Message[]; leads: Lead[] } | null> {
  if (!isUuid(conversationId)) return null;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.siteId, siteId)))
    .limit(1);
  if (!conversation) return null;
  const [msgs, leadRows] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt), asc(messages.id)),
    db
      .select()
      .from(leads)
      .where(and(eq(leads.conversationId, conversation.id), eq(leads.siteId, siteId)))
      .orderBy(desc(leads.createdAt)),
  ]);
  return { conversation, messages: msgs, leads: leadRows };
}
