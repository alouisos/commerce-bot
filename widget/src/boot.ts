import { h, render } from "preact";
import { fetchConfig } from "./api";
import css from "./styles.css";
import { App, type ConciergeApi } from "./ui/App";
import { createVisitTracker } from "./visit";

type Queued = unknown[];
type Win = Window & { Concierge?: { q?: Queued[] } | ConciergeApi };

const ROOT_ID = "concierge-root";

function findScript(doc: Document, current: Element | null): HTMLScriptElement | null {
  if (current instanceof HTMLScriptElement && current.dataset.site) return current;
  return doc.querySelector<HTMLScriptElement>("script[src*='widget.js'][data-site]");
}

export async function boot(doc: Document, win: Window, current: Element | null): Promise<void> {
  const script = findScript(doc, current);
  const key = script?.dataset.site;
  if (!script || !key) {
    console.warn("[concierge] widget script needs a data-site attribute");
    return;
  }
  if (doc.getElementById(ROOT_ID)) return;
  const apiBase = new URL(script.src, win.location.href).origin;

  let config;
  try {
    config = await fetchConfig(apiBase, key, doc.documentElement.lang || null);
  } catch (err) {
    console.warn("[concierge] widget disabled:", err instanceof Error ? err.message : err);
    return;
  }
  if (doc.getElementById(ROOT_ID)) return;
  if (!doc.body) await new Promise((r) => doc.addEventListener("DOMContentLoaded", r, { once: true }));

  const queue = ((win as Win).Concierge as { q?: Queued[] } | undefined)?.q ?? [];

  const host = doc.createElement("div");
  host.id = ROOT_ID;
  // Important so host-page `!important` rules cannot restyle the host element.
  host.style.setProperty("all", "initial", "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = css;
  const mountPoint = doc.createElement("div");
  shadow.append(style, mountPoint);
  doc.body.appendChild(host);

  let store: Storage;
  try {
    store = win.sessionStorage;
  } catch {
    store = { getItem: () => null, setItem: () => {} } as unknown as Storage;
  }

  let replayed = false;
  const register = (api: ConciergeApi) => {
    (win as Win).Concierge = { open: api.open, close: api.close };
    if (replayed) return;
    replayed = true;
    for (const [cmd] of queue.splice(0)) {
      if (cmd === "open") api.open();
      else if (cmd === "close") api.close();
    }
  };

  // Behaviour stays in this tab's sessionStorage for this visit; only a summary is sent, with a chat or a
  // suggestion request. Tracked whatever the dial says, so conversations show their intent and pages.
  const tracker = createVisitTracker({ doc, win, store });
  render(h(App, { config, apiBase, siteKey: key, store, register, tracker }), mountPoint);
}
