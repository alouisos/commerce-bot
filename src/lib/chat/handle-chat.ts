import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contacts, conversations, messages, promptImpressions, type Conversation } from "@/db/schema";
import { copyFor } from "@/lib/copy/defaults";
import { restartSequence } from "@/lib/email/schedule";
import { searchKnowledge } from "@/lib/kb/search";
import { MAX_VISITOR_MESSAGES_PER_CONVERSATION } from "@/lib/plans";
import { aiBlocked, countConversation, getQuota, recordModelUsage } from "@/lib/usage/meter";
import { hit } from "@/lib/usage/rate-limit";
import { appBaseUrl, siteLanguages } from "@/lib/widget/config";
import { isUuid } from "@/lib/widget/conversation";
import {
  clientIp,
  corsHeaders,
  resolveWidgetRequest,
  sidSchema,
  WidgetError,
  withWidgetErrors,
  type WidgetSite,
} from "@/lib/widget/guard";
import { resolveLanguage } from "@/lib/widget/language";
import { pageSchema, visitSchema } from "@/lib/widget/schemas";
import { LIMITS, type ChatEvent, type WidgetImage } from "@/shared/widget-protocol";
import { createMarkerFilter, extractImageMarkers } from "./images";
import { streamModelReply, type ModelRequest } from "./model";
import { buildContext, buildSystemPrompt } from "./prompt";

const HISTORY_LIMIT = 20;
const SEARCH_K = 6;

const chatSchema = z.object({
  sid: sidSchema,
  cid: z.string().max(100).nullish().transform((v) => v ?? null),
  message: z.string().trim().min(1).max(LIMITS.messageMaxChars),
  page: pageSchema,
  // Optional context: an odd or oversized summary is dropped rather than failing the visitor's chat.
  visit: visitSchema.nullish().catch(null).transform((v) => v ?? null),
  promptId: z.string().max(100).nullish().transform((v) => v ?? null),
  // From an email link; anything malformed is ignored.
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish().catch(null).transform((v) => v ?? null),
});

type ChatInput = z.infer<typeof chatSchema>;

export type ChatOptions = {
  /** Receives the detached completion (stream consumed, reply saved, usage recorded). It never rejects. */
  onSettled?: (finished: Promise<void>) => void;
};

const encoder = new TextEncoder();

function sseHeaders(origin: string): Headers {
  const h = corsHeaders(origin);
  h.set("Content-Type", "text/event-stream");
  h.set("Cache-Control", "no-cache, no-transform");
  h.set("X-Accel-Buffering", "no");
  return h;
}

/**
 * An SSE response whose writer outlives the client: after a disconnect
 * (`cancel()` or the request's abort signal) writes are silently dropped.
 */
function openSse(req: Request, origin: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  req.signal.addEventListener("abort", () => (closed = true), { once: true });
  return {
    response: new Response(stream, { status: 200, headers: sseHeaders(origin) }),
    send(event: ChatEvent) {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // already closed by the runtime
      }
    },
  };
}

async function findConversation(siteId: string, sid: string, cid: string | null): Promise<Conversation | null> {
  if (!isUuid(cid)) return null;
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, cid), eq(conversations.siteId, siteId), eq(conversations.visitorSessionId, sid)));
  return row ?? null;
}

/**
 * The suggestion this visit tapped to start the chat, marked tapped. Only an impression offered to this
 * site and this visit counts; anything else is ignored.
 */
async function claimImpression(siteId: string, sid: string, promptId: string | null) {
  if (!isUuid(promptId)) return null;
  const mine = and(
    eq(promptImpressions.id, promptId),
    eq(promptImpressions.siteId, siteId),
    eq(promptImpressions.visitorSessionId, sid),
  );
  const [row] = await db.select({ id: promptImpressions.id, text: promptImpressions.text }).from(promptImpressions).where(mine);
  if (!row) return null;
  await db
    .update(promptImpressions)
    .set({ outcome: "tapped", outcomeAt: new Date() })
    .where(and(mine, isNull(promptImpressions.outcome)));
  return row;
}

/** A subscribed contact of this site with this attribution ref; another site's ref matches nothing. */
async function subscribedContactByRef(siteId: string, ref: string | null) {
  if (!ref) return null;
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.ref, ref), eq(contacts.status, "subscribed")));
  return row ?? null;
}

/** The text of the suggestion that started the conversation, from the impression (never from the request). */
async function startingSuggestion(impressionId: string | null): Promise<string | null> {
  if (!impressionId) return null;
  const [row] = await db
    .select({ text: promptImpressions.text })
    .from(promptImpressions)
    .where(eq(promptImpressions.id, impressionId));
  return row?.text ?? null;
}

async function countVisitorMessages(conversationId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "visitor")));
  return Number(row?.n ?? 0);
}

async function addMessage(
  conversationId: string,
  values: { role: "visitor" | "bot"; content: string; kind?: "chat" | "fallback"; imageIds?: string[] },
): Promise<string> {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, ...values })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  await db.update(conversations).set({ lastMessageAt: row.createdAt }).where(eq(conversations.id, conversationId));
  return row.id;
}

/** Last chat messages before `excludeId`, oldest first; fallback replies are not part of what the model said. */
async function loadHistory(conversationId: string, excludeId: string): Promise<ModelRequest["history"]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.kind, "chat"), ne(messages.id, excludeId)))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HISTORY_LIMIT);
  return rows.reverse().map((r) => ({ role: r.role === "visitor" ? "user" : "assistant", content: r.content }));
}

async function parseBody(req: Request): Promise<ChatInput> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  return chatSchema.parse(body);
}

function fallbackResponse(req: Request, origin: string, cid: string, text: string): Response {
  const sse = openSse(req, origin);
  sse.send({ type: "start", cid });
  sse.send({ type: "fallback", cid, text });
  sse.close();
  return sse.response;
}

/** Streams the model's reply; completion (save + usage) runs to the end even if the client goes away. */
async function runModelReply(
  sse: ReturnType<typeof openSse>,
  ctx: {
    site: WidgetSite;
    conversationId: string;
    visitorMessageId: string;
    language: string;
    input: ChatInput;
    startedFrom: string | null;
  },
): Promise<void> {
  const { site, conversationId, input } = ctx;
  const sendFallback = async (err: unknown) => {
    console.error("chat model error", { siteId: site.id, conversationId }, err);
    const text = copyFor(ctx.language).fallback;
    await addMessage(conversationId, { role: "bot", content: text, kind: "fallback" });
    sse.send({ type: "fallback", cid: conversationId, text });
  };

  let result: Awaited<ReturnType<typeof streamModelReply>["done"]>;
  let imageHits: { id: string; caption: string }[];
  try {
    const hits = await searchKnowledge(site.id, `${input.message} ${input.page.title}`, SEARCH_K);
    imageHits = hits.filter((h) => h.kind === "image").map((h) => ({ id: h.sourceId, caption: h.caption ?? h.title }));
    const history = await loadHistory(conversationId, ctx.visitorMessageId);
    const reply = streamModelReply({
      system: buildSystemPrompt(site),
      history,
      message: input.message,
      context: buildContext(input.page, hits, imageHits, { summary: input.visit, startedFrom: ctx.startedFrom }),
    });
    reply.done.catch(() => {});
    const filter = createMarkerFilter();
    for await (const chunk of reply.textStream) {
      const text = filter.push(chunk);
      if (text) sse.send({ type: "delta", text });
    }
    const tail = filter.flush();
    if (tail) sse.send({ type: "delta", text: tail });
    result = await reply.done;
  } catch (err) {
    await sendFallback(err);
    return;
  }

  const { text, imageIds } = extractImageMarkers(result.text, new Set(imageHits.map((i) => i.id)));
  const messageId = await addMessage(conversationId, { role: "bot", content: text, imageIds });
  const captions = new Map(imageHits.map((i) => [i.id, i.caption]));
  const key = encodeURIComponent(site.publicKey);
  const images: WidgetImage[] = imageIds.map((id) => ({
    id,
    url: `${appBaseUrl()}/api/widget/image/${id}?key=${key}`,
    caption: captions.get(id) ?? "",
  }));
  sse.send({ type: "done", messageId, images });
  // The stream closes (in the caller's finally) only after usage is recorded, so a reader that waits for
  // the end of the body knows the whole turn is persisted; the widget can act on `done` right away.
  await recordModelUsage({ accountId: site.accountId, siteId: site.id, kind: "chat", model: result.model, usage: result.usage });
}

export const handleChat = withWidgetErrors<ChatOptions | undefined>(async (req, opts) => {
  const input = await parseBody(req);
  const key = new URL(req.url).searchParams.get("key");
  const { site, origin } = await resolveWidgetRequest(req, key);

  if (
    !(await hit(`chat:sid:${input.sid}`, 20, 300)) ||
    !(await hit(`chat:ip:${clientIp(req)}`, 60, 300)) ||
    !(await hit(`chat:site:${site.id}`, 300, 300))
  ) {
    throw new WidgetError(429, "Too many requests");
  }

  const now = new Date();
  // Snapshot before counting this conversation, so the decision reflects conversations already served.
  const quota = await getQuota(site.account, now);

  const visitFields = input.visit
    ? { intent: input.visit.intent, intentConfidence: input.visit.confidence, visit: input.visit }
    : {};
  let conversation = await findConversation(site.id, input.sid, input.cid);
  if (!conversation) {
    const language = resolveLanguage(input.page.lang, await siteLanguages(site.id), site.defaultLanguage);
    const impression = await claimImpression(site.id, input.sid, input.promptId);
    const contact = await subscribedContactByRef(site.id, input.ref);
    [conversation] = await db
      .insert(conversations)
      .values({
        siteId: site.id,
        visitorSessionId: input.sid,
        language,
        firstPageUrl: input.page.url,
        promptImpressionId: impression?.id ?? null,
        contactId: contact?.id ?? null,
        ...visitFields,
      })
      .returning();
  } else if (input.visit) {
    [conversation] = await db
      .update(conversations)
      .set(visitFields)
      .where(eq(conversations.id, conversation.id))
      .returning();
  }
  const conversationId = conversation.id;
  const language = conversation.language;

  const previousVisitorMessages = await countVisitorMessages(conversationId);
  if (previousVisitorMessages === 0) await countConversation(site.accountId, now);
  const visitorMessageId = await addMessage(conversationId, { role: "visitor", content: input.message });
  // Back from one of our emails and chatting again: follow-ups now come from this conversation.
  if (previousVisitorMessages === 0 && conversation.contactId) {
    await restartSequence(conversation.contactId, conversationId, now);
  }

  // No model call when the account can't spend more this month, or this conversation already had its share.
  if (aiBlocked(quota) || previousVisitorMessages >= MAX_VISITOR_MESSAGES_PER_CONVERSATION) {
    const text = copyFor(language).fallback;
    await addMessage(conversationId, { role: "bot", content: text, kind: "fallback" });
    return fallbackResponse(req, origin, conversationId, text);
  }

  const sse = openSse(req, origin);
  sse.send({ type: "start", cid: conversationId });
  const startedFrom = await startingSuggestion(conversation.promptImpressionId);
  const finished = runModelReply(sse, { site, conversationId, visitorMessageId, language, input, startedFrom })
    .catch((err) => console.error("chat completion failed", { siteId: site.id, conversationId }, err))
    .finally(() => sse.close());
  opts?.onSettled?.(finished);
  return sse.response;
});
