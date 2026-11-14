import { and, asc, desc, eq, gte, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, conversations, messages, siteInsights, sites, type SiteInsight } from "@/db/schema";
import { getAnthropic } from "@/lib/ai/anthropic";
import { meteredModel, type TokenUsage } from "@/lib/ai/pricing";
import { env } from "@/lib/env";
import { ownerAiBlocked, recordModelUsage } from "@/lib/usage/meter";
import {
  buildInsightsInput,
  INSIGHTS_JSON_SCHEMA,
  insightsSystem,
  MIN_CONVERSATIONS,
  WINDOW_MS,
  type InsightWindow,
  parseInsights,
  type InsightsContent,
  type InsightsConversation,
} from "./prompt";

const MAX_CONVERSATIONS = 150;

type CallModel = (system: string, input: string) => Promise<{ content: unknown; model: string; usage: TokenUsage }>;

export type InsightsResult =
  | { status: "created"; insight: SiteInsight }
  | { status: "skipped"; reason: "no-conversations" | "too-few" | "ai-blocked" | "up-to-date" };

const FAKE: InsightsContent = {
  summary: "Test insights",
  topQuestions: [],
  knowledgeGaps: [],
  objections: [],
  curiousProducts: [],
};

/** One Claude call that returns the insights as JSON. Throws on a refusal or an empty reply. */
const defaultCallModel: CallModel = async (system, input) => {
  const model = env.CHAT_MODEL;
  if (env.FAKE_MODEL) {
    return { content: FAKE, model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  }
  const res = await getAnthropic().beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: INSIGHTS_JSON_SCHEMA } },
    system,
    messages: [{ role: "user", content: input }],
  });
  const usage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
  const block = res.content.find((b) => b.type === "text");
  let content: unknown = null;
  if (res.stop_reason !== "refusal" && block?.type === "text") {
    try {
      content = JSON.parse(block.text);
    } catch {
      content = null; // reported as unexpected insights below, after metering
    }
  }
  return { content, model: meteredModel(res.model, model), usage };
};

/**
 * Writes a fresh insight for the site from the window's conversations (at most 150, newest first).
 * Skips when there is nothing to read (or too little: see MIN_CONVERSATIONS), the account can't use AI, or nothing changed since the last insight.
 * Usage is metered as soon as the model answers, so a reply that can't be used still counts once.
 */
export async function generateSiteInsights(
  siteId: string,
  opts: { window: InsightWindow; now?: Date; callModel?: CallModel },
): Promise<InsightsResult> {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - WINDOW_MS[opts.window]);

  const [row] = await db
    .select({ site: sites, account: accounts })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!row) throw new Error(`Unknown site ${siteId}`);
  const { site, account } = row;

  const recent = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.siteId, site.id), eq(conversations.isTest, false), gte(conversations.lastMessageAt, from)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(MAX_CONVERSATIONS);
  if (recent.length === 0) return { status: "skipped", reason: "no-conversations" };

  if (recent.length < MIN_CONVERSATIONS[opts.window]) return { status: "skipped", reason: "too-few" };

  if (await ownerAiBlocked(account, now)) return { status: "skipped", reason: "ai-blocked" };

  const [[previous], [{ lastMessage }]] = await Promise.all([
    db
      .select({ createdAt: siteInsights.createdAt })
      .from(siteInsights)
      .where(and(eq(siteInsights.siteId, site.id), eq(siteInsights.window, opts.window)))
      .orderBy(desc(siteInsights.createdAt))
      .limit(1),
    db
      .select({ lastMessage: max(conversations.lastMessageAt) })
      .from(conversations)
      .where(and(eq(conversations.siteId, site.id), eq(conversations.isTest, false))),
  ]);
  if (previous && lastMessage && previous.createdAt > lastMessage) {
    return { status: "skipped", reason: "up-to-date" };
  }

  const msgs = await db
    .select({
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      kind: messages.kind,
    })
    .from(messages)
    .where(inArray(messages.conversationId, recent.map((c) => c.id)))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  const byConv = new Map<string, InsightsConversation["messages"]>();
  for (const m of msgs) {
    const list = byConv.get(m.conversationId) ?? [];
    list.push({ role: m.role, content: m.content, kind: m.kind });
    byConv.set(m.conversationId, list);
  }
  const input = buildInsightsInput(
    recent.map((c) => ({ startedAt: c.createdAt, firstPageUrl: c.firstPageUrl, messages: byConv.get(c.id) ?? [] })),
  );

  const reply = await (opts.callModel ?? defaultCallModel)(insightsSystem(recent.length), input);
  await recordModelUsage({
    accountId: account.id,
    siteId: site.id,
    kind: "insights",
    model: reply.model,
    usage: reply.usage,
    now,
  });
  const content = parseInsights(reply.content);
  if (!content) throw new Error("The model returned unexpected insights");

  const [insight] = await db
    .insert(siteInsights)
    .values({
      siteId: site.id,
      window: opts.window,
      periodFrom: from,
      periodTo: now,
      conversationCount: recent.length,
      content,
      model: reply.model,
      createdAt: now,
    })
    .returning();
  return { status: "created", insight };
}
