import type { ChatEvent, PromptOffer, WidgetConfig } from "../../src/shared/widget-protocol";

export const API = "http://app.test";

export const config: WidgetConfig = {
  botName: "Mila",
  accentColor: "#0a7f5a",
  corner: "bottom-right",
  language: "en",
  greeting: { message: "Hi, ask me anything", imageUrl: null },
  iconUrl: null,
  strings: {
    disclosure: "AI can make mistakes. Check important info.",
    fallback: "We cannot answer right now. Leave your email.",
    leadThanks: "Thanks, we will be in touch.",
    open: "Open chat",
    close: "Close chat",
    placeholder: "Type a message",
    send: "Send",
    emailLabel: "Your email",
    questionLabel: "Your question",
    poweredBy: "Powered by Concierge",
    dismissPrompt: "Dismiss suggestion",
    consentAsk: "Want personalised recommendations by email?",
    consentFine: "By sending your email you agree to emails from Shop. Unsubscribe any time.",
    consentYes: "Yes, email me",
    consentNo: "No thanks",
    consentThanks: "Thanks! Check your inbox to confirm.",
  },
  showBadge: true,
  mode: "ai",
  proactivity: "gentle",
  pausedKinds: [],
  emailCapture: false,
  consentMode: "auto",
};

export function sseBody(events: ChatEvent[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const e of events) {
        const { type, ...rest } = e;
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type, ...rest })}\n\n`));
      }
      c.close();
    },
  });
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(routes: {
  chat?: ChatEvent[] | (() => Response);
  conversation?: unknown;
  lead?: number;
  /** null answers 204 (no suggestion). */
  prompt?: PromptOffer | null;
  subscribe?: number;
}) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const handler: Handler = (url) => {
    if (url.pathname.endsWith("/chat")) {
      if (typeof routes.chat === "function") return routes.chat();
      return new Response(sseBody(routes.chat ?? []), { status: 200 });
    }
    if (url.pathname.endsWith("/conversation")) {
      return new Response(JSON.stringify(routes.conversation ?? { messages: [] }), { status: 200 });
    }
    if (url.pathname.endsWith("/lead")) return new Response("{}", { status: routes.lead ?? 201 });
    if (url.pathname.endsWith("/prompt")) {
      return routes.prompt ? new Response(JSON.stringify(routes.prompt), { status: 200 }) : new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/subscribe")) return new Response("{}", { status: routes.subscribe ?? 201 });
    if (url.pathname.endsWith("/prompt-event")) return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  };
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}
