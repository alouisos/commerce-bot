import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { scoreIntent } from "../../src/shared/intent";
import { PROMPT_MIN_VISIBLE_MS, PROMPT_VISIBLE_MS, promptBlockReason, type GateState } from "../../src/shared/prompt-rules";
import type { PromptOffer, WidgetConfig } from "../../src/shared/widget-protocol";
import { fetchPrompt, sendPromptEvent } from "./api";
import { collectPageContext } from "./page-context";
import { getPromptState, getSession, updatePromptState } from "./session";
import type { VisitTracker } from "./visit";

const TICK_MS = 1000;

const pageKey = () => `${window.location.origin}${window.location.pathname}`;

/** The `test` field, only from a test tab: a normal visitor's requests stay exactly as they were. */
export const withTest = (testKey: string | null): { test?: string } => (testKey ? { test: testKey } : {});

/**
 * Offers at most one suggestion at a time, only when the shared gate allows it. Anything unclear,
 * including a failed request, means no suggestion.
 */
export function usePrompts(opts: {
  tracker: VisitTracker | undefined;
  config: WidgetConfig;
  apiBase: string;
  siteKey: string;
  store: Storage;
  /** The panel or the greeting is showing. */
  busy: boolean;
  /** The owner's test key, when the server confirmed this tab as a test tab. */
  testKey?: string | null;
}): {
  offer: PromptOffer | null;
  dismiss(): void;
  tap(): PromptOffer | null;
  silence(): void;
  /** The visitor sent a chat message on this page. */
  chatSent(): void;
  /** The panel was closed. */
  chatClosed(): void;
  /** This page loaded without the panel open: after a chat, that counts as closing it at page start. */
  arrivedClosed(): void;
} {
  const { tracker, config, apiBase, siteKey, store, busy } = opts;
  const testKey = opts.testKey ?? null;
  const testMode = testKey !== null;
  const [offer, setOffer] = useState<PromptOffer | null>(null);
  const offerRef = useRef<PromptOffer | null>(null);
  const busyRef = useRef(busy);
  const inFlight = useRef(false);
  // Test tab: "already asked on this page" lasts for this page load only, so a reload asks again.
  const requestedHere = useRef(new Set<string>());
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const show = useCallback((o: PromptOffer | null) => {
    offerRef.current = o;
    setOffer(o);
  }, []);

  const gate = useCallback(
    (requesting: boolean): { state: GateState; intent: ReturnType<typeof scoreIntent> } | null => {
      if (!tracker) return null;
      const ps = getPromptState(store);
      const signals = tracker.signals();
      const intent = scoreIntent(signals);
      const state: GateState = {
        proactivity: config.proactivity,
        aiAvailable: config.mode === "ai",
        silenced: ps.silenced,
        busy: busyRef.current || !!offerRef.current || (requesting && inFlight.current),
        pageKind: signals.pageKind,
        shownThisVisit: ps.shown,
        requestedOnPage:
          requesting && (testMode ? requestedHere.current.has(pageKey()) : ps.requestedPages.includes(pageKey())),
        pageStartedAt: tracker.pageStartedAt(),
        lastShownAt: ps.lastShownAt,
        lastScrollAt: tracker.lastScrollAt(),
        intent: intent.intent,
        confidence: intent.confidence,
        pausedKinds: config.pausedKinds,
        testMode,
        chatted: ps.chatted,
        onChatPage: ps.chatPages.includes(pageKey()),
        chatClosedAt: ps.chatClosedAt,
        postChatShown: ps.postChatShown,
      };
      return promptBlockReason(state, Date.now()) === null ? { state, intent } : null;
    },
    [tracker, store, config.proactivity, config.mode, config.pausedKinds, testMode],
  );

  // The loop: ask the gate once a second; request only when it allows.
  useEffect(() => {
    if (!tracker || config.proactivity === "off") return;
    let cancelled = false;
    const timer = setInterval(() => {
      const ok = gate(true);
      if (!ok || !ok.intent.intent) return;
      const ps = getPromptState(store);
      // Marked before the request, so a failure or an empty answer still counts as "asked on this page".
      updatePromptState(store, { requestedPages: [...ps.requestedPages, pageKey()] });
      requestedHere.current.add(pageKey());
      inFlight.current = true;
      const { sid, cid } = getSession(store);
      void fetchPrompt(apiBase, {
        key: siteKey,
        sid,
        page: collectPageContext(document, window),
        intent: ok.intent.intent,
        confidence: ok.intent.confidence,
        // After a chat the suggestion may build on it; before one, the request stays as it was.
        ...(ps.chatted && cid ? { cid } : {}),
        ...withTest(testKey),
      }).then((o) => {
        inFlight.current = false;
        // The visitor may have opened the chat, scrolled or dismissed something while we waited.
        if (cancelled || !o || !gate(false)) return;
        const now = getPromptState(store);
        updatePromptState(store, {
          shown: now.shown + 1,
          lastShownAt: Date.now(),
          ...(now.chatted ? { postChatShown: now.postChatShown + 1 } : {}),
        });
        show(o);
        sendPromptEvent(apiBase, { key: siteKey, sid, id: o.id, event: "shown", ...withTest(testKey) });
      });
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tracker, config.proactivity, gate, store, apiBase, siteKey, show, testKey]);

  // A shown suggestion goes away by itself after a while, or when the visitor scrolls on (ignored) —
  // but it stays up for its first PROMPT_MIN_VISIBLE_MS so there's time to tap it.
  useEffect(() => {
    if (!offer) return;
    const shownAt = Date.now();
    const hide = () => show(null);
    const onScroll = () => {
      if (Date.now() - shownAt >= PROMPT_MIN_VISIBLE_MS) hide();
    };
    const t = setTimeout(hide, PROMPT_VISIBLE_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [offer, show]);

  // Only an explicit no silences suggestions (× on one or on the greeting, No to the email ask), and
  // nothing does in a test tab.
  const silence = useCallback(() => {
    if (!testMode) updatePromptState(store, { silenced: true });
  }, [store, testMode]);

  const report = useCallback(
    (event: "tapped" | "dismissed") => {
      const o = offerRef.current;
      if (!o) return null;
      sendPromptEvent(apiBase, { key: siteKey, sid: getSession(store).sid, id: o.id, event, ...withTest(testKey) });
      // × is a no; a tap opens the chat, which the post-chat rules handle.
      if (event === "dismissed") silence();
      show(null);
      return o;
    },
    [apiBase, siteKey, store, silence, show, testKey],
  );

  // Recorded in a test tab too: its suggestions also build on the conversation.
  const chatSent = useCallback(() => {
    const ps = getPromptState(store);
    const page = pageKey();
    updatePromptState(store, {
      chatted: true,
      chatPages: ps.chatPages.includes(page) ? ps.chatPages : [...ps.chatPages, page],
      chatClosedAt: null,
    });
  }, [store]);

  const chatClosed = useCallback(() => {
    if (getPromptState(store).chatted) updatePromptState(store, { chatClosedAt: Date.now() });
  }, [store]);

  const arrivedClosed = useCallback(() => {
    const ps = getPromptState(store);
    if (!ps.chatted) return;
    const start = tracker?.pageStartedAt() ?? Date.now();
    updatePromptState(store, { chatClosedAt: Math.max(ps.chatClosedAt ?? 0, start) });
  }, [store, tracker]);

  return {
    offer,
    dismiss: useCallback(() => void report("dismissed"), [report]),
    tap: useCallback(() => report("tapped"), [report]),
    silence,
    chatSent,
    chatClosed,
    arrivedClosed,
  };
}
