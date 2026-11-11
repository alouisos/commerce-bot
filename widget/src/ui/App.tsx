/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StoredMessage, WidgetConfig } from "../../../src/shared/widget-protocol";
import { fetchConversation, sendChat, sendLead, sendSubscribe } from "../api";
import { onColor } from "../color";
import { collectPageContext } from "../page-context";
import { usePrompts } from "../prompts";
import {
  consentAsked,
  getRef,
  getSession,
  hasTeased,
  markConsentAsked,
  markTeased,
  setConversationId,
} from "../session";
import type { VisitTracker } from "../visit";
import { Launcher } from "./Launcher";
import { Panel, type UiMessage } from "./Panel";
import { Prompt } from "./Prompt";
import { Teaser } from "./Teaser";

export type ConciergeApi = { open(): void; close(): void };

const TEASER_DELAY_MS = 1500;
/** The email offer comes only after this many completed bot replies in the conversation. */
const CONSENT_AFTER_REPLIES = 2;
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
}: {
  config: WidgetConfig;
  apiBase: string;
  siteKey: string;
  store: Storage;
  register?: (api: ConciergeApi) => void;
  /** Behaviour for intent and suggestions; without it there are no suggestions. */
  tracker?: VisitTracker;
}) {
  const { strings } = config;
  const forcedFallback = config.mode === "fallback";
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [fallback, setFallback] = useState(forcedFallback);
  // "open" while offered, "thanks" after yes, "closed" when asked before this visit or after no.
  const [consent, setConsent] = useState<"open" | "thanks" | "closed">(() =>
    consentAsked(store) ? "closed" : "open",
  );
  const launcherRef = useRef<HTMLButtonElement>(null);
  const cidRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const prompts = usePrompts({ tracker, config, apiBase, siteKey, store, busy: open || teaser });
  const { silence } = prompts;

  const openPanel = useCallback(() => {
    // Opening the chat, by any route, ends suggestions for the visit.
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

  // Teaser: once per session, 1.5 s after load.
  useEffect(() => {
    if (hasTeased(store)) return;
    const t = setTimeout(() => {
      markTeased(store);
      setTeaser(true);
    }, TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [store]);

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
    [apiBase, siteKey, store, strings.fallback, tracker],
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

  const botReplies = messages.filter((m) => m.role === "bot").length;
  const offerConsent =
    config.emailCapture && !fallback && consent !== "closed" && botReplies >= CONSENT_AFTER_REPLIES;
  const consentYes = useCallback(
    async (email: string) => {
      markConsentAsked(store);
      const { sid } = getSession(store);
      try {
        await sendSubscribe(apiBase, { key: siteKey, sid, cid: cidRef.current, email, language: config.language });
        setConsent("thanks");
      } catch {
        // A missed email is fine; the offer just goes away.
        setConsent("closed");
      }
    },
    [apiBase, siteKey, store, config.language],
  );
  const consentNo = useCallback(() => {
    markConsentAsked(store);
    setConsent("closed");
  }, [store]);

  return (
    <div
      class={`cc ${config.corner === "bottom-left" ? "left" : "right"}`}
      style={{ "--accent": config.accentColor, "--on-accent": onColor(config.accentColor) }}
    >
      {teaser && !open && (
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
          onClose={closePanel}
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
