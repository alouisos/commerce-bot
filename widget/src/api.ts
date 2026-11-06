import type {
  ChatEvent,
  ChatRequest,
  LeadRequest,
  StoredMessage,
  WidgetConfig,
} from "../../src/shared/widget-protocol";
import { parseSSE } from "./sse";

function url(apiBase: string, path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `${apiBase}/api/widget/${path}?${q.toString()}`;
}

export async function fetchConfig(apiBase: string, key: string, lang: string | null): Promise<WidgetConfig> {
  const res = await fetch(url(apiBase, "config", { key, lang }));
  if (!res.ok) throw new Error(`config ${res.status}`);
  return (await res.json()) as WidgetConfig;
}

export async function fetchConversation(
  apiBase: string,
  key: string,
  sid: string,
  cid: string,
): Promise<StoredMessage[]> {
  const res = await fetch(url(apiBase, "conversation", { key, sid, cid }));
  if (!res.ok) throw new Error(`conversation ${res.status}`);
  const body = (await res.json()) as { messages: StoredMessage[] };
  return body.messages;
}

/** Throws on a non-200 response or network failure; the caller treats that as a fallback. */
export async function* sendChat(apiBase: string, req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
  const res = await fetch(url(apiBase, "chat", { key: req.key }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (res.status !== 200 || !res.body) throw new Error(`chat ${res.status}`);
  yield* parseSSE(res.body);
}

export async function sendLead(apiBase: string, req: LeadRequest): Promise<void> {
  const res = await fetch(url(apiBase, "lead", { key: req.key }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`lead ${res.status}`);
}
