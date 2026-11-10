// Seeing a purchase: the order-confirmation page. One beacon per page per visit, only while tracking is allowed.
import { LIMITS } from "../../src/shared/widget-protocol";
import { sendOrder } from "./api";
import { getRef, getSession } from "./session";

const KEY = "concierge.orders";
const MAX_REMEMBERED = 20;
const WOO_PATH = /\/order-received\/(\d+)\/?$/;
const WOO_KEY = /^wc_order_[A-Za-z0-9]{6,40}$/;
const GENERIC_PATH = /(order-confirmation|thank-?you|thank_you|checkout\/(onepage\/)?success)(\/|$)/i;
const ORDER_WORDS = /order|παραγγελ|commande|bestellung|pedido|ordine/i;

export function detectOrderConfirmation(
  doc: Document,
  win: Window,
): { orderId: string | null; orderKey: string | null } | null {
  const path = win.location.pathname;
  const woo = WOO_PATH.exec(path);
  if (woo || doc.body?.classList.contains("woocommerce-order-received")) {
    const key = new URLSearchParams(win.location.search).get("key");
    return { orderId: woo ? woo[1] : null, orderKey: woo && key && WOO_KEY.test(key) ? key : null };
  }
  if (GENERIC_PATH.test(path)) {
    const headings = Array.from(doc.querySelectorAll("h1, h2")).map((h) => h.textContent ?? "");
    if (headings.some((t) => ORDER_WORDS.test(t))) return { orderId: null, orderKey: null };
  }
  return null;
}

function remembered(store: Storage): string[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function reportOrderOnce(opts: { doc: Document; win: Window; store: Storage; apiBase: string; siteKey: string }): void {
  const { doc, win, store } = opts;
  const found = detectOrderConfirmation(doc, win);
  if (!found) return;
  const url = `${win.location.origin}${win.location.pathname}`.slice(0, LIMITS.urlMaxChars);
  const seen = remembered(store);
  if (seen.includes(url)) return;
  try {
    store.setItem(KEY, JSON.stringify([...seen, url].slice(-MAX_REMEMBERED)));
  } catch {
    // storage blocked: may send again on reload; the server dedupes
  }
  const { sid } = getSession(store);
  sendOrder(opts.apiBase, { key: opts.siteKey, sid, url, orderId: found.orderId, orderKey: found.orderKey, ref: getRef(store) });
}
