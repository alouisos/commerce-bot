import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations } from "@/db/schema";
import type { StatsRange } from "@/lib/stats/range";

export type ConversationFilter = "all" | "email" | "unanswered";

export type ConversationRow = {
  id: string;
  createdAt: Date;
  lastMessageAt: Date;
  language: string;
  firstPageUrl: string | null;
  visitorMessages: number;
  preview: string;
  hasEmail: boolean;
  unanswered: boolean;
};

export const PAGE_SIZE = 25;
const MAX_QUERY = 200;
const PREVIEW = 140;

export const FILTERS: Record<ConversationFilter, string> = {
  all: "All",
  email: "Email captured",
  unanswered: "Unanswered",
};

export function parseFilter(v: string | string[] | undefined): ConversationFilter {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw === "email" || raw === "unanswered" ? raw : "all";
}

// Spelled out: inside a select list Drizzle renders a column without its table, which would bind to `m.id`.
const convId = sql.raw(`"conversations"."id"`);

/** `%text%` for ILIKE, with LIKE's wildcards and the escape character taken literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const hasEmail = sql<boolean>`exists (select 1 from leads l where l.conversation_id = ${convId})`;
const unanswered = sql<boolean>`exists (select 1 from messages m where m.conversation_id = ${convId} and m.kind = 'fallback')`;

/** One site's conversations started in the range, newest activity first, optionally searched and filtered. */
export async function listConversations(
  siteId: string,
  opts: { range: StatsRange; q?: string; filter?: ConversationFilter; page?: number },
): Promise<{ rows: ConversationRow[]; total: number; page: number; pageCount: number }> {
  const where: (SQL | undefined)[] = [
    eq(conversations.siteId, siteId),
    gte(conversations.createdAt, opts.range.from),
    lte(conversations.createdAt, opts.range.to),
  ];
  if (opts.filter === "email") where.push(hasEmail);
  if (opts.filter === "unanswered") where.push(unanswered);
  // NUL can't be sent to Postgres in a text parameter; drop it rather than fail the page.
  const q = (opts.q ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_QUERY);
  if (q) {
    where.push(
      sql`exists (select 1 from messages m where m.conversation_id = ${convId} and m.content ilike ${likePattern(q)} escape '\\')`,
    );
  }
  const cond = and(...where);

  const [{ total }] = await db.select({ total: count() }).from(conversations).where(cond);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), pageCount);
  if (total === 0) return { rows: [], total, page, pageCount };

  const rows = await db
    .select({
      id: conversations.id,
      createdAt: conversations.createdAt,
      lastMessageAt: conversations.lastMessageAt,
      language: conversations.language,
      firstPageUrl: conversations.firstPageUrl,
      visitorMessages: sql<number>`(select count(*) from messages m where m.conversation_id = ${convId} and m.role = 'visitor')`.mapWith(
        Number,
      ),
      first: sql<string | null>`(select m.content from messages m where m.conversation_id = ${convId} and m.role = 'visitor' order by m.created_at, m.id limit 1)`,
      hasEmail,
      unanswered,
    })
    .from(conversations)
    .where(cond)
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    rows: rows.map(({ first, ...r }) => {
      const text = (first ?? "").replace(/\s+/g, " ").trim();
      return { ...r, preview: text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text };
    }),
    total,
    page,
    pageCount,
  };
}
