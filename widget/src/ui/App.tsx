/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StoredMessage, WidgetConfig } from "../../../src/shared/widget-protocol";
import { fetchConversation, sendChat, sendLead, sendSubscribe } from "../api";
import { onColor } from "../color";
import { consentReplies } from "../consent-timing";
import { collectPageContext } from "../page-context";
import { usePrompts, withTest } from "../prompts";
import {
  clearTestKey,
  consentAsked,
  getRef,
  getSession,
  getTestKey,
  hasTeased,
  markConsentAsked,
  markReopen,
  markTeased,
  setConversationId,
  takeReopen,
} from "../session";
import type { VisitTracker } from "../visit";
import { Launcher } from "./Launcher";
import { Panel, type UiMessage } from "./Panel";
import { Prompt } from "./Prompt";
import { Teaser } from "./Teaser";

export type ConciergeApi = { open(): void; close(): void };

const TEASER_DELAY_MS = 1500;
let localId = 0;
const nextId = () => `local-${++localId}`;

function fromStored(m: StoredMessage): UiMessage {
  return { id: m.id, role: m.role, content: m.content, images: m.images };
}

export function App({
  config,
  apiBase,
  siteKey,
  store,
  register,
  tracker,
  reload = () => window.location.reload(),
}: {
  config: WidgetConfig;
  apiBase: string;
  siteKey: string;
  store: Storage;
  register?: (api: ConciergeApi) => void;
  /** Behaviour for intent and suggestions; without it there are no suggestions. */
  tracker?: VisitTracker;
  /** Reloads the page (leaving test mode). */
  reload?: () => void;
}) {
  const { strings } = config;
  // The owner's test tab: only when the server confirmed the key this tab stored.
  const [testKey] = useState(() => (config.testMode === true ? getTestKey(store) : null));
  const testMode = testKey !== null;
  const forcedFallback = config.mode === "fallback";
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  // After following a chat link on a narrow screen: offer to continue rather than cover the new page.
  const [continueOffer, setContinueOffer] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [fallback, setFallback] = useState(forcedFallback);
  // "open" while offered, "thanks" after yes, "closed" when asked before this visit or after no.
  // A test tab asks in every conversation.
  const [consent, setConsent] = useState<"open" | "thanks" | "closed">(() =>
    !testMode && consentAsked(store) ? "closed" : "open",
  );
  const launcherRef = useRef<HTMLButtonElement>(null);
  const cidRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const prompts = usePrompts({ tracker, config, apiBase, siteKey, store, busy: open || teaser, testKey });
  const { silence } = prompts;

  const openPanel = useCallback(() => {
    // Opening the chat, by any route, ends suggestions for the visit (not in a test tab).
    silence();
    setTeaser(false);
    setOpen(true);
  }, [silence]);
  const closePanel = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    register?.({ open: openPanel, close: closePanel });
  }, [register, openPanel, closePanel]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Arriving from a link in the chat: carry the conversation on. Wide screens reopen the panel;
  // on phones (where the panel is full-screen) a bubble offers it instead of hiding the page.
  useEffect(() => {
    if (!takeReopen(store)) return;
    if (window.matchMedia?.("(max-width: 479px)").matches) setContinueOffer(true);
    else openPanel();
    // Runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teaser: once per session (on every page load in a test tab), 1.5 s after load.
  useEffect(() => {
    if (!testMode && hasTeased(store)) return;
    const t = setTimeout(() => {
      markTeased(store);
      setTeaser(true);
    }, TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [store, testMode]);

  // Full-screen layout: lock host page scroll while open.
  useEffect(() => {
    if (!open || !window.matchMedia?.("(max-width: 479px)").matches) return;
    const el = document.documentElement;
    const previous = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = previous;
    };
  }, [open]);

  // Opening: restore the stored conversation (navigation restore) or show the fallback notice.
  useEffect(() => {
    if (!open || restoredRef.current) return;
    restoredRef.current = true;
    const { sid, cid } = getSession(store);
    cidRef.current = cid;
    if (forcedFallback) {
      setMessages([{ id: nextId(), role: "bot", content: strings.fallback, images: [] }]);
      return;
    }
    if (!cid) return;
    let cancelled = false;
    fetchConversation(apiBase, siteKey, sid, cid)
      .then((stored) => {
        if (cancelled) return;
        setMessages((current) => [...stored.map(fromStored), ...current]);
        if (stored.some((m) => m.kind === "fallback")) setFallback(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, store, apiBase, siteKey, forcedFallback, strings.fallback]);

  const send = useCallback(
    async (text: string, promptId: string | null = null) => {
      const { sid, cid } = getSession(store);
      cidRef.current = cid;
      setMessages((m) => [...m, { id: nextId(), role: "visitor", content: text, images: [] }]);
      setStreaming(true);
      setPending("");
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = "";
      let outcome: "done" | "fallback" | null = null;
      let images: UiMessage["images"] = [];
      try {
        const req = {
          key: siteKey,
          sid,
          cid,
          message: text,
          page: collectPageContext(document, window),
          visit: tracker?.summary() ?? null,
          promptId,
          ref: getRef(store),
          ...withTest(testKey),
        };
        for await (const ev of sendChat(apiBase, req, ctrl.signal)) {
          if (ev.type === "start") {
            // The cid is stored only here. A navigation before `start` arrives cannot be restored;
            // the server sends `start` before retrieval and the model, so that window is network latency only.
            cidRef.current = ev.cid;
            setConversationId(store, ev.cid);
          } else if (ev.type === "delta") {
            acc += ev.text;
            setPending(acc);
          } else if (ev.type === "done") {
            outcome = "done";
            images = ev.images;
          } else if (ev.type === "fallback") {
            cidRef.current = ev.cid;
            setConversationId(store, ev.cid);
            outcome = "fallback";
          }
        }
      } catch {
        // network failure or non-200: handled as a fallback below
        if (ctrl.signal.aborted) return;
      }
      setPending("");
      setStreaming(false);
      if (outcome === "done") {
        setMessages((m) => [...m, { id: nextId(), role: "bot", content: acc, images }]);
      } else {
        setMessages((m) => [...m, { id: nextId(), role: "bot", content: strings.fallback, images: [] }]);
        setFallback(true);
      }
    },
    [apiBase, siteKey, store, strings.fallback, tracker, testKey],
  );

  const tapPrompt = useCallback(() => {
    const o = prompts.tap();
    if (!o) return;
    openPanel();
    void send(o.question, o.id);
  }, [prompts, openPanel, send]);

  const lead = useCallback(
    async (email: string, message: string) => {
      const { sid } = getSession(store);
      await sendLead(apiBase, { key: siteKey, sid, cid: cidRef.current, email, message });
    },
    [apiBase, siteKey, store],
  );

  // The greeting is not in `messages`, so every bot message here is a reply to the visitor.
  const botReplies = messages.filter((m) => m.role === "bot").length;
  // Read at decision time; null when there is no tracker (tracking not allowed).
  const intent = tracker?.summary().intent ?? null;
  // A test tab asks after the first reply; it still needs a site that can send email.
  const offerConsent =
    config.emailCapture && !fallback && consent !== "closed" && botReplies >= (testMode ? 1 : consentReplies(intent));
  const consentYes = useCallback(
    async (email: string) => {
      markConsentAsked(store);
      const { sid } = getSession(store);
      try {
        await sendSubscribe(apiBase, {
          key: siteKey,
          sid,
          cid: cidRef.current,
          email,
          language: config.language,
          ...withTest(testKey),
        });
        setConsent("thanks");
      } catch {
        // A missed email is fine; the offer just goes away.
        setConsent("closed");
      }
    },
    [apiBase, siteKey, store, config.language, testKey],
  );
  const consentNo = useCallback(() => {
    markConsentAsked(store);
    setConsent("closed");
  }, [store]);

  const exitTest = useCallback(() => {
    clearTestKey(store);
    reload();
  }, [store, reload]);

  return (
    <div
      class={`cc ${config.corner === "bottom-left" ? "left" : "right"}`}
      style={{ "--accent": config.accentColor, "--on-accent": onColor(config.accentColor) }}
    >
      {continueOffer && !open && (
        <Teaser
          message={strings.continueChat}
          imageUrl={null}
          closeLabel={strings.close}
          onOpen={() => {
            setContinueOffer(false);
            openPanel();
          }}
          onDismiss={() => setContinueOffer(false)}
        />
      )}
      {teaser && !open && !continueOffer && (
        <Teaser
          message={config.greeting.message}
          imageUrl={null}
          closeLabel={strings.close}
          onOpen={openPanel}
          onDismiss={() => setTeaser(false)}
          onClose={() => {
            silence();
            setTeaser(false);
          }}
        />
      )}
      {prompts.offer && !open && !teaser && (
        <Prompt
          text={prompts.offer.text}
          dismissLabel={strings.dismissPrompt}
          onTap={tapPrompt}
          onDismiss={prompts.dismiss}
        />
      )}
      {open && (
        <Panel
          config={config}
          apiBase={apiBase}
          messages={messages}
          pending={pending}
          streaming={streaming}
          fallback={fallback}
          onSend={(text) => void send(text)}
          onLead={lead}
          onFollowLink={() => markReopen(store)}
          onClose={closePanel}
          onExitTest={testMode ? exitTest : null}
          consent={offerConsent ? { done: consent === "thanks", onYes: consentYes, onNo: consentNo } : null}
        />
      )}
      <Launcher
        label={strings.open}
        expanded={open}
        onClick={() => (open ? closePanel() : openPanel())}
        buttonRef={launcherRef}
        iconUrl={config.iconUrl}
      />
    </div>
  );
}
