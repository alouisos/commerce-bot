import { h, render } from "preact";
import { fetchConfig } from "./api";
import { detectConsent, onConsentChange } from "./consent";
import { setRef } from "./session";
import css from "./styles.css";
import { App, type ConciergeApi } from "./ui/App";
import { createVisitTracker, type VisitTracker } from "./visit";

type Queued = unknown[];
type PublicApi = { open(): void; close(): void; consent(granted: boolean): void };
type Win = Window & { Concierge?: { q?: Queued[] } | PublicApi };

const ROOT_ID = "concierge-root";

function findScript(doc: Document, current: Element | null): HTMLScriptElement | null {
  if (current instanceof HTMLScriptElement && current.dataset.site) return current;
  return doc.querySelector<HTMLScriptElement>("script[src*='widget.js'][data-site]");
}

function sessionStore(win: Window): Storage {
  try {
    return win.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} } as unknown as Storage;
  }
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
  const mode = config.consentMode ?? "auto";

  // Consent the site gave through Concierge.consent(), on top of any detected tool.
  let siteConsent: boolean | null = null;
  const consented = () => siteConsent ?? detectConsent(win).granted;
  // auto: a detected tool decides about tracking; without one, behaviour stays per visit as before.
  const mayTrack = () => {
    if (mode === "off" || siteConsent === true) return true;
    if (siteConsent === false) return false;
    const { tool, granted } = detectConsent(win);
    return tool === null ? mode === "auto" : granted;
  };

  let api: ConciergeApi | null = null;
  let mountPoint: HTMLDivElement | null = null;
  let store: Storage | null = null;
  let tracker: VisitTracker | undefined;
  let replayed = false;

  const publicApi: PublicApi = {
    open: () => api?.open(),
    close: () => api?.close(),
    consent: (granted: boolean) => {
      siteConsent = granted === true;
      update();
    },
  };

  const register = (a: ConciergeApi) => {
    api = a;
    if (replayed) return;
    replayed = true;
    for (const [cmd] of queue.splice(0)) {
      if (cmd === "open") a.open();
      else if (cmd === "close") a.close();
    }
  };

  const draw = () => {
    if (!mountPoint || !store) return;
    render(h(App, { config, apiBase, siteKey: key, store, register, tracker }), mountPoint);
  };

  function mount() {
    const host = doc.createElement("div");
    host.id = ROOT_ID;
    // Important so host-page `!important` rules cannot restyle the host element.
    host.style.setProperty("all", "initial", "important");
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = css;
    mountPoint = doc.createElement("div");
    shadow.append(style, mountPoint);
    doc.body.appendChild(host);
    store = sessionStore(win);
    // Arrived from one of the shop's emails: remember the link's ref for this visit. The URL is left alone.
    try {
      setRef(store, new URLSearchParams(win.location.search).get("cc_ref"));
    } catch {
      // no usable location
    }
  }

  function update() {
    if (!mountPoint) {
      if (mode === "required" && !consented()) return;
      mount();
    }
    // Behaviour stays in this tab's sessionStorage for this visit; only a summary is sent, with a chat or a
    // suggestion request. Tracked whatever the dial says, so conversations show their intent and pages.
    if (!tracker && mayTrack()) {
      tracker = createVisitTracker({ doc, win, store: store! });
    } else if (tracker && !mayTrack()) {
      tracker.dispose();
      tracker = undefined;
    }
    draw();
  }

  (win as Win).Concierge = publicApi;
  for (const item of queue.filter(([cmd]) => cmd === "consent")) {
    siteConsent = item[1] === true;
  }
  queue.splice(0, queue.length, ...queue.filter(([cmd]) => cmd !== "consent"));
  if (mode !== "off") onConsentChange(win, update);
  update();
}
