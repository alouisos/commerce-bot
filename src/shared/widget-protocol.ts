// Shared between the server and the embeddable widget bundle.
// Types and constants only: never import anything server-side here.
//
// Transport notes:
// - Every widget request, including POSTs, carries `?key=<public key>` in the
//   query string. The CORS preflight has no body, so the server reads the key
//   from the query for OPTIONS.
// - Visitor identity (`sid`) is a random id in sessionStorage, per visit only.
// - Test mode: a tab opened from the admin's install page keeps the site's test key in sessionStorage
//   and sends it as `test` (config: `?test=`). Only the server decides whether it is valid; an unknown or
//   invalid key is normal mode, never an error.

export const LIMITS = {
  messageMaxChars: 2000,
  headingsMax: 20,
  headingMaxChars: 200,
  visibleTextMaxChars: 4000,
  titleMaxChars: 300,
  urlMaxChars: 2000,
  visitPagesMax: 10,
} as const;

export type PageKind = "product" | "cart" | "checkout" | "content" | "listing" | "home" | "other";
export type Intent = "learning" | "exploring" | "buying";
export type PromptKind = "question" | "pairing";
export type Proactivity = "off" | "gentle" | "active";

/** What the visitor did this visit, sent with chats so the bot (and the admin) see the context. */
export type VisitSummary = {
  intent: Intent | null;
  confidence: number;
  pages: { url: string; title: string; seconds: number }[];
  addedToCart: boolean;
  cartSeen: boolean;
};

export type PageContext = {
  url: string;
  title: string;
  lang: string | null;
  headings: string[];
  visibleText: string;
  product: { name: string; price: string | null; currency: string | null } | null;
  kind: PageKind;
};

export type WidgetStrings = {
  disclosure: string;
  fallback: string;
  leadThanks: string;
  open: string;
  close: string;
  placeholder: string;
  send: string;
  emailLabel: string;
  questionLabel: string;
  poweredBy: string;
  dismissPrompt: string;
  consentAsk: string;
  /** Contains `{site}` until the server fills in the site's name. */
  consentFine: string;
  consentYes: string;
  consentNo: string;
  consentThanks: string;
  /** Bubble offering to reopen the chat after following one of its links (narrow screens). */
  continueChat: string;
};

export type WidgetConfig = {
  botName: string;
  accentColor: string;
  corner: "bottom-right" | "bottom-left";
  language: string;
  greeting: { message: string; imageUrl: string | null };
  /** The round launcher button's image (the site's uploaded image), or null for the default glyph. */
  iconUrl: string | null;
  strings: WidgetStrings;
  showBadge: boolean;
  mode: "ai" | "fallback";
  proactivity: Proactivity;
  /** Suggestion types paused on this site because visitors keep dismissing them. */
  pausedKinds: PromptKind[];
  /** The bot may offer personalised emails: the site has a verified sending domain and emails left. */
  emailCapture: boolean;
  /** auto: follow a detected consent tool for tracking; required: wait for consent to appear at all; off: never wait. */
  consentMode: "auto" | "required" | "off";
  /** The request carried this site's valid test key: the owner's test tab (see `test` on requests). */
  testMode: boolean;
};

export type WidgetImage = { id: string; url: string; caption: string };

export type StoredMessage = {
  id: string;
  role: "visitor" | "bot";
  content: string;
  images: WidgetImage[];
  kind: "chat" | "fallback";
};

export type ChatRequest = {
  key: string;
  sid: string;
  cid: string | null;
  message: string;
  page: PageContext;
  /** What the visitor did before writing; older bundles don't send it. */
  visit?: VisitSummary | null;
  /** The suggestion the visitor tapped to start this chat. */
  promptId?: string | null;
  /** The attribution reference from an email link (cc_ref), kept for the visit. */
  ref?: string | null;
  /** The owner's test key, sent only from a tab the server confirmed as a test tab. */
  test?: string;
};

export type ChatEvent =
  | { type: "start"; cid: string }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; images: WidgetImage[] }
  | { type: "fallback"; cid: string; text: string };

export type LeadRequest = {
  key: string;
  sid: string;
  cid: string | null;
  email: string;
  message: string;
};

export type SubscribeRequest = {
  key: string;
  sid: string;
  cid: string | null;
  email: string;
  language: string;
  test?: string;
};

/** Sent once from an order-confirmation page, when tracking is allowed. */
export type OrderRequest = {
  key: string;
  sid: string;
  url: string;
  orderId: string | null;
  orderKey: string | null;
  ref: string | null;
};

export type PromptRequest = {
  key: string;
  sid: string;
  page: PageContext;
  intent: Intent;
  confidence: number;
  test?: string;
};

/** A suggestion to show. `question` is what gets sent as the visitor's message if they tap it. */
export type PromptOffer = { id: string; text: string; question: string };

export type PromptEventRequest = {
  key: string;
  sid: string;
  id: string;
  event: "shown" | "tapped" | "dismissed";
  test?: string;
};
