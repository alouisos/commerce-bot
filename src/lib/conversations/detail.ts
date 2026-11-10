import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  conversations,
  leads,
  messages,
  promptImpressions,
  sales,
  type Conversation,
  type Lead,
  type Message,
  type Sale,
} from "@/db/schema";
import type { PromptKind } from "@/shared/widget-protocol";
import { isUuid } from "@/lib/widget/conversation";

/** One conversation of the site with its messages (oldest first) and leads, or null if the site has no such one. */
export async function getConversation(
  siteId: string,
  conversationId: string,
): Promise<{
  conversation: Conversation;
  messages: Message[];
  leads: Lead[];
  prompt: { text: string; kind: PromptKind } | null;
  sales: Sale[];
} | null> {
  if (!isUuid(conversationId)) return null;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.siteId, siteId)))
    .limit(1);
  if (!conversation) return null;
  const [msgs, leadRows, promptRows, saleRows] = await Promise.all([
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
    conversation.promptImpressionId
      ? db
          .select({ text: promptImpressions.text, kind: promptImpressions.kind })
          .from(promptImpressions)
          .where(and(eq(promptImpressions.id, conversation.promptImpressionId), eq(promptImpressions.siteId, siteId)))
      : Promise.resolve([]),
    db
      .select()
      .from(sales)
      .where(and(eq(sales.conversationId, conversation.id), eq(sales.siteId, siteId)))
      .orderBy(asc(sales.orderedAt)),
  ]);
  return { conversation, messages: msgs, leads: leadRows, prompt: promptRows[0] ?? null, sales: saleRows };
}
