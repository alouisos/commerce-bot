// What the visitor does during this visit, for intent and suggestions.
// Per visit only: sessionStorage (or memory when storage is blocked), never cookies.
import { scoreIntent, type IntentSignals } from "../../src/shared/intent";
import { LIMITS, type PageKind, type VisitSummary } from "../../src/shared/widget-protocol";
import { detectPageKind } from "./page-context";

const KEY = "concierge.visit";
const MAX_PAGES = 20;
const SKIM_WINDOW_MS = 3000;
const SKIM_PX_PER_S = 2500;
const ADD_TO_CART =
  '.add_to_cart_button, .single_add_to_cart_button, [name="add-to-cart"], a[href*="add-to-cart="]';

type PageView = { url: string; title: string; kind: PageKind; seconds: number; maxScroll: number };
type Stored = { pages: PageView[]; addedToCart: boolean };

export type VisitTracker = {
  signals(): IntentSignals;
  summary(): VisitSummary;
  pageKind(): PageKind;
  pageStartedAt(): number;
  lastScrollAt(): number | null;
  dispose(): void;
};

function load(store: Storage): Stored | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return Array.isArray(v?.pages) ? { pages: v.pages.slice(-MAX_PAGES), addedToCart: !!v.addedToCart } : null;
  } catch {
    return null;
  }
}

function pageUrl(win: Window): string {
  const { origin, pathname } = win.location;
  return `${origin}${pathname}`.slice(0, LIMITS.urlMaxChars);
}

export function createVisitTracker(opts: {
  doc: Document;
  win: Window;
  store: Storage;
  now?: () => number;
}): VisitTracker {
  const { doc, win, store } = opts;
  const now = opts.now ?? (() => Date.now());
  const state: Stored = load(store) ?? { pages: [], addedToCart: false };
  let canWrite = true;
  let startedAt = now();
  let lastScroll: number | null = null;
  let scrolls: { t: number; dy: number }[] = [];
  let lastY = win.scrollY;
  let current_ = pageUrl(win);

  const save = () => {
    if (!canWrite) return;
    try {
      store.setItem(KEY, JSON.stringify(state));
    } catch {
      canWrite = false; // memory is the source of truth for this page
    }
  };

  const scrollDepth = () => {
    const height = doc.documentElement.scrollHeight;
    if (!height || height <= win.innerHeight) return 1;
    return Math.min(1, Math.max(0, (win.scrollY + win.innerHeight) / height));
  };

  const startView = () => {
    state.pages.push({
      url: pageUrl(win),
      title: doc.title.replace(/\s+/g, " ").trim().slice(0, LIMITS.titleMaxChars),
      kind: detectPageKind(doc, win),
      seconds: 0,
      maxScroll: scrollDepth(),
    });
    if (state.pages.length > MAX_PAGES) state.pages.splice(0, state.pages.length - MAX_PAGES);
    startedAt = now();
    lastScroll = null;
    scrolls = [];
    save();
  };
  const current = () => state.pages[state.pages.length - 1];
  startView();

  const onScroll = () => {
    const t = now();
    const y = win.scrollY;
    scrolls.push({ t, dy: Math.abs(y - lastY) });
    lastY = y;
    lastScroll = t;
    const view = current();
    view.maxScroll = Math.max(view.maxScroll, scrollDepth());
  };
  const markAdded = () => {
    if (state.addedToCart) return;
    state.addedToCart = true;
    save();
  };
  const onClick = (e: Event) => {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest(ADD_TO_CART)) markAdded();
  };
  const onSubmit = (e: Event) => {
    const form = e.target instanceof HTMLFormElement ? e.target : null;
    if (form && /\/cart\/add/.test(form.getAttribute("action") ?? "")) markAdded();
  };
  /** True when the page changed without a reload (a single-page navigation) and a new view started. */
  const onUrlChange = () => {
    // Same page when only the query or the #fragment changes (e.g. a "#reviews" link).
    const url = pageUrl(win);
    if (url === current_) return false;
    current_ = url;
    startView();
    return true;
  };
  const timer = win.setInterval(() => {
    // A page view that starts on this tick has had no visible time yet.
    if (onUrlChange()) return;
    if (doc.visibilityState === "visible") {
      current().seconds += 1;
      save();
    }
  }, 1000);

  const passive = { passive: true, capture: true } as const;
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("popstate", onUrlChange);
  doc.addEventListener("click", onClick, passive);
  doc.addEventListener("submit", onSubmit, passive);

  const signals = (): IntentSignals => {
    const view = current();
    const t = now();
    const recent = scrolls.filter((s) => t - s.t <= SKIM_WINDOW_MS);
    scrolls = recent;
    const distance = recent.reduce((sum, s) => sum + s.dy, 0);
    // A return visit needs another page in between: a reload of the same page is not one.
    let lastOther = state.pages.length - 2;
    while (lastOther >= 0 && state.pages[lastOther].url === view.url) lastOther--;
    const earlier = state.pages.slice(0, Math.max(0, lastOther));
    return {
      pageKind: view.kind,
      seconds: view.seconds,
      maxScroll: view.maxScroll,
      fastScroll: distance / (SKIM_WINDOW_MS / 1000) > SKIM_PX_PER_S,
      productPages: new Set(state.pages.filter((p) => p.kind === "product").map((p) => p.url)).size,
      revisitedProduct: view.kind === "product" && earlier.some((p) => p.url === view.url),
      addedToCart: state.addedToCart,
      cartSeen: state.pages.some((p) => p.kind === "cart"),
    };
  };

  return {
    signals,
    summary() {
      const s = signals();
      const { intent, confidence } = scoreIntent(s);
      return {
        intent,
        confidence,
        pages: state.pages.slice(-LIMITS.visitPagesMax).map(({ url, title, seconds }) => ({ url, title, seconds })),
        addedToCart: s.addedToCart,
        cartSeen: s.cartSeen,
      };
    },
    pageKind: () => current().kind,
    pageStartedAt: () => startedAt,
    lastScrollAt: () => lastScroll,
    dispose() {
      win.clearInterval(timer);
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("popstate", onUrlChange);
      doc.removeEventListener("click", onClick, passive);
      doc.removeEventListener("submit", onSubmit, passive);
    },
  };
}
