import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources, messages, promptCache, promptImpressions } from "@/db/schema";
import { getAnthropic } from "@/lib/ai/anthropic";
import { meteredModel, type TokenUsage } from "@/lib/ai/pricing";
import { buildContext } from "@/lib/chat/prompt";
import { env } from "@/lib/env";
import { redactEmails } from "@/lib/privacy/redact";
import { findOwnedConversation } from "@/lib/widget/conversation";
import { searchKnowledge } from "@/lib/kb/search";
import { atConversationLimit } from "@/lib/usage/levels";
import { aiBlocked, getQuota, recordModelUsage } from "@/lib/usage/meter";
import { siteLanguages } from "@/lib/widget/config";
import type { WidgetSite } from "@/lib/widget/guard";
import { resolveLanguage } from "@/lib/widget/language";
import { kindForIntent } from "@/shared/intent";
import type { Intent, PageContext, PromptOffer } from "@/shared/widget-protocol";
import { pausedKinds } from "./backoff";
import { normalizeUrl } from "@/lib/crawl/discover";
import { LIMITS } from "@/shared/widget-protocol";
import { cleanSuggestion, conversationSection, KIND_INSTRUCTIONS, PROMPT_JSON_SCHEMA, promptSystem } from "./writer";

const CACHE_MS = 7 * 24 * 3600_000;
const SEARCH_K = 6;
/** What a suggestion after a chat sees of it: the last few messages, each cut short. */
const EXCERPT_MESSAGES = 6;
const EXCERPT_CHARS = 300;

type CallModel = (system: string, input: string) => Promise<{ content: unknown; model: string; usage: TokenUsage }>;

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const defaultCallModel: CallModel = async (system, input) => {
  const model = env.CHAT_MODEL;
  if (env.FAKE_MODEL) {
    return {
      content: { show: true, text: "Want to know who this suits best?", question: "Who does this suit best?" },
      model,
      usage: ZERO,
    };
  }
  const res = await getAnthropic().beta.messages.create({
    model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: PROMPT_JSON_SCHEMA } },
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
      content = null; // shown as nothing; usage is still metered by the caller
    }
  }
  return { content, model: meteredModel(res.model, model), usage };
};

/**
 * The page as the crawl learned it, found by the address the browser reported (normalized the way the
 * crawler stores it, without query or fragment). Suggestions are written only from this server-side copy:
 * page text sent by a browser is never used, so a forged request can't plant a suggestion other
 * visitors would see. Pages the crawl doesn't know get no suggestion.
 */
async function crawledPage(siteId: string, url: string): Promise<{ url: string; title: string; text: string } | null> {
  let key: string | null;
  try {
    const u = new URL(url);
    key = normalizeUrl(`${u.origin}${u.pathname}`);
  } catch {
    key = null;
  }
  if (!key) return null;
  const [source] = await db
    .select({ id: kbSources.id, url: kbSources.url, title: kbSources.title })
    .from(kbSources)
    .where(
      and(
        eq(kbSources.siteId, siteId),
        eq(kbSources.kind, "page"),
        eq(kbSources.url, key),
        eq(kbSources.status, "ready"),
        eq(kbSources.excluded, false),
      ),
    )
    .limit(1);
  if (!source?.url) return null;
  const chunks = await db
    .select({ content: kbChunks.content })
    .from(kbChunks)
    .where(eq(kbChunks.sourceId, source.id))
    .orderBy(asc(kbChunks.ordinal));
  const text = chunks.map((c) => c.content).join("\n\n").slice(0, LIMITS.visibleTextMaxChars);
  return { url: source.url, title: source.title, text };
}

/**
 * The end of this visit's own conversation (site and sid must own it), oldest first, with email
 * addresses removed before each message is cut short. Anything else, or an empty chat, gives null.
 */
async function conversationExcerpt(
  siteId: string,
  sid: string,
  cid: string | null | undefined,
): Promise<{ role: "visitor" | "bot"; content: string }[] | null> {
  const owned = cid ? await findOwnedConversation(siteId, sid, cid) : null;
  if (!owned) return null;
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, owned))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(EXCERPT_MESSAGES);
  const lines = rows
    .reverse()
    .map((m) => ({ role: m.role, content: redactEmails(m.content).replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS) }))
    .filter((m) => m.content);
  return lines.length > 0 ? lines : null;
}

/**
 * A suggestion for this visitor on this page, or null. Never calls the model when suggestions are off,
 * on checkout, for a paused type, when the account can't use AI, or when the page's suggestion is cached.
 * After a chat (`cid` of this visit's own conversation) the suggestion builds on it and is personal:
 * the cache is neither read nor written. Any other cid is ignored.
 */
export async function offerPrompt(
  site: WidgetSite,
  input: { sid: string; page: PageContext; intent: Intent; confidence: number; cid?: string | null },
  opts: { now?: Date; callModel?: CallModel; testMode?: boolean } = {},
): Promise<PromptOffer | null> {
  const now = opts.now ?? new Date();
  const testMode = opts.testMode === true;
  const kind = kindForIntent(input.intent);
  if (site.proactivity === "off" || input.page.kind === "checkout") return null;
  // The owner's test tab sees every type; its impressions are marked so back-off and stats skip them.
  if (!testMode && (await pausedKinds(site.id, now)).includes(kind)) return null;
  if (aiBlocked(await getQuota(site.account, now))) return null;
  if (await atConversationLimit(site.account, now)) return null;

  const crawled = await crawledPage(site.id, input.page.url);
  if (!crawled) return null;
  const key = crawled.url;
  const language = resolveLanguage(input.page.lang, await siteLanguages(site.id), site.defaultLanguage);
  const conversation = await conversationExcerpt(site.id, input.sid, input.cid);
  // A suggestion that builds on this visitor's chat is personal: never taken from the cache.
  const [cached] = conversation
    ? []
    : await db
        .select()
        .from(promptCache)
        .where(
          and(
            eq(promptCache.siteId, site.id),
            eq(promptCache.urlKey, key),
            eq(promptCache.kind, kind),
            eq(promptCache.language, language),
            gte(promptCache.createdAt, new Date(now.getTime() - CACHE_MS)),
          ),
        )
        .limit(1);

  let suggestion: { text: string; question: string } | null;
  if (cached) {
    suggestion = cached.text && cached.question ? { text: cached.text, question: cached.question } : null;
  } else {
    const page: PageContext = {
      url: crawled.url,
      title: crawled.title,
      lang: language,
      headings: [],
      visibleText: crawled.text,
      product: null,
      kind: input.page.kind,
    };
    const hits = (await searchKnowledge(site.id, crawled.title, SEARCH_K)).filter((h) => h.url !== crawled.url);
    const prompt = [
      `Write in the language with ISO code ${language}.`,
      KIND_INSTRUCTIONS[kind],
      "",
      buildContext(page, hits, []),
      ...(conversation ? ["", conversationSection(conversation)] : []),
    ].join("\n");
    const system = promptSystem(site.guardrails, { conversation: conversation !== null });
    const reply = await (opts.callModel ?? defaultCallModel)(system, prompt);
    await recordModelUsage({
      accountId: site.accountId,
      siteId: site.id,
      kind: "prompt",
      model: reply.model,
      usage: reply.usage,
      now,
    });
    suggestion = cleanSuggestion(reply.content);
    // ... nor written to it.
    if (!conversation) {
      const values = { text: suggestion?.text ?? null, question: suggestion?.question ?? null, model: reply.model, createdAt: now };
      await db
        .insert(promptCache)
        .values({ siteId: site.id, urlKey: key, kind, language, ...values })
        .onConflictDoUpdate({
          target: [promptCache.siteId, promptCache.urlKey, promptCache.kind, promptCache.language],
          set: values,
        });
    }
  }
  if (!suggestion) return null;

  const [impression] = await db
    .insert(promptImpressions)
    .values({
      siteId: site.id,
      visitorSessionId: input.sid,
      kind,
      intent: input.intent,
      confidence: input.confidence,
      language,
      pageUrl: key,
      text: suggestion.text,
      question: suggestion.question,
      isTest: testMode,
    })
    .returning({ id: promptImpressions.id });
  return { id: impression.id, ...suggestion };
}
