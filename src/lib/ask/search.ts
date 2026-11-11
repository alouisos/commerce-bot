// Finds the conversations an owner's question is about, for Ask the Concierge.
import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, messages, sites } from "@/db/schema";
import { redactEmails } from "@/lib/privacy/redact";

const DAY = 24 * 60 * 60 * 1000;
export const LOOKBACK_DAYS = 90;
const DEFAULT_LIMIT = 40;
const PER_CONVERSATION = 2_000;
const MAX_TERMS = 12;

export type FoundConversation = { id: string; startedAt: Date; transcript: string };

/** Distinct words of three or more letters, at most MAX_TERMS: each becomes one OR'd search term. */
function terms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/** One `plainto_tsquery` per word joined with OR: a natural question rarely has every word in one message. */
function tsQuery(words: string[]): SQL {
  return sql.join(
    words.map((w) => sql`plainto_tsquery('simple', ${w})`),
    sql` || `,
  );
}

/**
 * The site's conversations that best match the question (full-text over every message), from the last
 * 90 days or the site's retention if shorter. With no match, the newest conversations instead.
 * Transcripts are cut to 2,000 characters and have email addresses replaced with "[email]".
 */
export async function findRelevantConversations(
  siteId: string,
  question: string,
  opts: { now?: Date; limit?: number } = {},
): Promise<FoundConversation[]> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const [site] = await db.select({ retentionMonths: sites.retentionMonths }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return [];
  const retained = new Date(now);
  retained.setUTCMonth(retained.getUTCMonth() - site.retentionMonths);
  const from = new Date(Math.max(now.getTime() - LOOKBACK_DAYS * DAY, retained.getTime()));
  const inWindow = and(eq(conversations.siteId, siteId), gte(conversations.lastMessageAt, from));

  let ids: string[] = [];
  const words = terms(question);
  if (words.length > 0) {
    const doc = sql`to_tsvector('simple', ${messages.content})`;
    const query = tsQuery(words);
    const rank = sql`max(ts_rank(${doc}, ${query}))`;
    const matched = await db
      .select({ id: conversations.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(inWindow, sql`${doc} @@ (${query})`))
      .groupBy(conversations.id)
      .orderBy(desc(rank), desc(conversations.lastMessageAt))
      .limit(limit);
    ids = matched.map((m) => m.id);
  }
  if (ids.length === 0) {
    const newest = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(inWindow, sql`exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id})`))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit);
    ids = newest.map((m) => m.id);
  }
  if (ids.length === 0) return [];

  const [convs, msgs] = await Promise.all([
    db.select({ id: conversations.id, startedAt: conversations.createdAt }).from(conversations).where(inArray(conversations.id, ids)),
    db
      .select({ conversationId: messages.conversationId, role: messages.role, kind: messages.kind, content: messages.content })
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(asc(messages.createdAt), asc(messages.id)),
  ]);
  const lines = new Map<string, string[]>();
  for (const m of msgs) {
    const who = m.role === "visitor" ? "Visitor" : m.kind === "fallback" ? "Bot (couldn't answer)" : "Bot";
    const list = lines.get(m.conversationId) ?? [];
    list.push(`${who}: ${m.content.replace(/\s+/g, " ").trim()}`);
    lines.set(m.conversationId, list);
  }
  const started = new Map(convs.map((c) => [c.id, c.startedAt]));
  return ids.map((id) => {
    const body = redactEmails((lines.get(id) ?? []).join("\n"));
    return {
      id,
      startedAt: started.get(id)!,
      transcript: body.length > PER_CONVERSATION ? `${body.slice(0, PER_CONVERSATION)}…` : body,
    };
  });
}
