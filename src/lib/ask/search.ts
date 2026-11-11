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
/** A word in more than this share of the window's conversations says nothing about the subject ("the", "what", "και"). */
const COMMON_SHARE = 0.5;
/** Below this many conversations every word is kept: there are too few to tell common words apart. */
const MIN_FOR_COMMON = 10;

export type FoundConversation = { id: string; startedAt: Date; transcript: string };

/** Distinct words of three or more letters, at most MAX_TERMS: each becomes one OR'd search term. */
function terms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_TERMS);
}

const doc = sql`to_tsvector('simple', ${messages.content})`;
const wordQuery = (w: string) => sql`plainto_tsquery('simple', ${w})`;
/** One `plainto_tsquery` per word joined with OR: a natural question rarely has every word in one message. */
const anyWord = (words: string[]) => sql.join(words.map(wordQuery), sql` || `);

/**
 * Drops the words found in most of the window's conversations (an IDF-style cutoff, in one count query),
 * so stopwords in any language don't decide the ranking.
 */
async function distinctiveWords(words: string[], inWindow: SQL | undefined): Promise<string[]> {
  const fields: Record<string, SQL<number>> = { total: sql<number>`count(distinct ${conversations.id})::int` };
  words.forEach((w, i) => {
    fields[`w${i}`] = sql<number>`(count(distinct ${conversations.id}) filter (where ${doc} @@ ${wordQuery(w)}))::int`;
  });
  const [counts] = await db
    .select(fields)
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(inWindow);
  const total = Number(counts.total);
  if (total < MIN_FOR_COMMON) return words;
  return words.filter((_, i) => Number(counts[`w${i}`]) <= total * COMMON_SHARE);
}

/** At most PER_CONVERSATION characters; when the start would miss the first matching line, the excerpt starts there. */
function excerpt(lines: { text: string; hit: boolean }[]): string {
  const join = (ls: { text: string }[]) => ls.map((l) => l.text).join("\n");
  const whole = join(lines);
  if (whole.length <= PER_CONVERSATION) return whole;
  const first = lines.findIndex((l) => l.hit);
  let from = 0;
  if (first > 0 && join(lines.slice(0, first + 1)).length > PER_CONVERSATION) {
    // One line of context before the match (usually the question it answers) when both fit.
    from = lines[first - 1].text.length + 1 + lines[first].text.length < PER_CONVERSATION ? first - 1 : first;
  }
  const lead = from > 0 ? "…" : "";
  const body = join(lines.slice(from));
  const room = PER_CONVERSATION - lead.length;
  return `${lead}${body.length > room ? `${body.slice(0, room)}…` : body}`;
}

/**
 * The site's conversations that best match the question (full-text over every message), from the last
 * 90 days or the site's retention if shorter. With no match, the newest conversations instead.
 * Ranking: distinct question words matched, then ts_rank; words in most of the window's conversations are
 * ignored. Transcripts are cut to 2,000 characters around the first matching message and have email
 * addresses replaced with "[email]".
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
  const kept = words.length > 0 ? await distinctiveWords(words, inWindow) : [];
  const query = kept.length > 0 ? anyWord(kept) : null;
  if (query) {
    // Conversations matching more of the distinct words first, then ts_rank, then the newest.
    const wordsMatched = sql.join(
      kept.map((w) => sql`(bool_or(${doc} @@ ${wordQuery(w)}))::int`),
      sql` + `,
    );
    const matched = await db
      .select({ id: conversations.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(inWindow, sql`${doc} @@ (${query})`))
      .groupBy(conversations.id)
      .orderBy(desc(wordsMatched), desc(sql`max(ts_rank(${doc}, ${query}))`), desc(conversations.lastMessageAt))
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
      .select({
        conversationId: messages.conversationId,
        role: messages.role,
        kind: messages.kind,
        content: messages.content,
        hit: query ? sql<boolean>`${doc} @@ (${query})` : sql<boolean>`false`,
      })
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(asc(messages.createdAt), asc(messages.id)),
  ]);
  const lines = new Map<string, { text: string; hit: boolean }[]>();
  for (const m of msgs) {
    const who = m.role === "visitor" ? "Visitor" : m.kind === "fallback" ? "Bot (couldn't answer)" : "Bot";
    const list = lines.get(m.conversationId) ?? [];
    // Redacted per line before any cut, so a cut can't leave part of an address.
    list.push({ text: redactEmails(`${who}: ${m.content.replace(/\s+/g, " ").trim()}`), hit: Boolean(m.hit) });
    lines.set(m.conversationId, list);
  }
  const started = new Map(convs.map((c) => [c.id, c.startedAt]));
  return ids.map((id) => ({ id, startedAt: started.get(id)!, transcript: excerpt(lines.get(id) ?? []) }));
}
