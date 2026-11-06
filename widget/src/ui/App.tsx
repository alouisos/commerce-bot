/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StoredMessage, WidgetConfig } from "../../../src/shared/widget-protocol";
import { fetchConversation, sendChat, sendLead } from "../api";
import { onColor } from "../color";
import { collectPageContext } from "../page-context";
import { getSession, hasTeased, markTeased, setConversationId } from "../session";
import { Launcher } from "./Launcher";
import { Panel, type UiMessage } from "./Panel";
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
}: {
  config: WidgetConfig;
  apiBase: string;
  siteKey: string;
  store: Storage;
  register?: (api: ConciergeApi) => void;
}) {
  const { strings } = config;
  const forcedFallback = config.mode === "fallback";
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [fallback, setFallback] = useState(forcedFallback);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const cidRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const openPanel = useCallback(() => {
    setTeaser(false);
    setOpen(true);
  }, []);
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
    async (text: string) => {
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
        const req = { key: siteKey, sid, cid, message: text, page: collectPageContext(document, window) };
        for await (const ev of sendChat(apiBase, req, ctrl.signal)) {
          if (ev.type === "start") {
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
    [apiBase, siteKey, store, strings.fallback],
  );

  const lead = useCallback(
    async (email: string, message: string) => {
      const { sid } = getSession(store);
      await sendLead(apiBase, { key: siteKey, sid, cid: cidRef.current, email, message });
    },
    [apiBase, siteKey, store],
  );

  return (
    <div
      class={`cc ${config.corner === "bottom-left" ? "left" : "right"}`}
      style={{ "--accent": config.accentColor, "--on-accent": onColor(config.accentColor) }}
    >
      {teaser && !open && (
        <Teaser
          message={config.greeting.message}
          imageUrl={config.greeting.imageUrl}
          closeLabel={strings.close}
          onOpen={openPanel}
          onDismiss={() => setTeaser(false)}
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
          onSend={send}
          onLead={lead}
          onClose={closePanel}
        />
      )}
      <Launcher
        label={strings.open}
        expanded={open}
        onClick={() => (open ? closePanel() : openPanel())}
        buttonRef={launcherRef}
      />
    </div>
  );
}
