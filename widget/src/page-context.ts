import { LIMITS, type PageContext } from "../../src/shared/widget-protocol";

const TEXT_SELECTOR = "p, li, h1, h2, h3, h4, td, dd";
const WIDGET_ROOT = "#concierge-root";
const EDITABLE = '[contenteditable]:not([contenteditable="false"])';
const HIDDEN = '[aria-hidden="true"]';
const FIELD_TAGS = `textarea, select, input, script, style, noscript, ${EDITABLE}, ${HIDDEN}`;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

type Obj = Record<string, unknown>;

function flatten(node: unknown, out: Obj[]): void {
  if (Array.isArray(node)) return node.forEach((n) => flatten(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Obj;
  out.push(obj);
  if (obj["@graph"]) flatten(obj["@graph"], out);
}

function isProduct(o: Obj): boolean {
  const t = o["@type"];
  return t === "Product" || (Array.isArray(t) && t.includes("Product"));
}

function findProduct(doc: Document): PageContext["product"] {
  const nodes: Obj[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      flatten(JSON.parse(el.textContent ?? ""), nodes);
    } catch {
      // ignore malformed JSON-LD
    }
  });
  const p = nodes.find(isProduct);
  const name = p && str(p.name);
  if (!p || !name) return null;
  const offers: Obj[] = [];
  flatten(p.offers, offers);
  let price: string | null = null;
  let currency: string | null = null;
  for (const o of offers) {
    const spec = o.priceSpecification as Obj | undefined;
    price = str(o.price) ?? str(o.lowPrice) ?? str(spec?.price);
    if (price) {
      currency = str(o.priceCurrency) ?? str(spec?.priceCurrency);
      break;
    }
  }
  return {
    name: name.slice(0, LIMITS.titleMaxChars),
    price: price && price.slice(0, 50),
    currency: currency && currency.slice(0, 10),
  };
}

function ownText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(FIELD_TAGS).forEach((n) => n.remove());
  return clean(copy.textContent ?? "");
}

/** Editable, aria-hidden, or not rendered: never sent to the server. */
function excluded(el: Element, win: Window): boolean {
  if (el.closest(EDITABLE) || el.closest(HIDDEN)) return true;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
  }
  return false;
}

function inViewport(el: Element, win: Window): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  return r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
}

export function collectPageContext(doc: Document, win: Window): PageContext {
  const outside = (el: Element) => !el.closest(WIDGET_ROOT);

  const headings = Array.from(doc.querySelectorAll("h1, h2, h3"))
    .filter((h) => outside(h) && !excluded(h, win))
    .map((h) => ownText(h).slice(0, LIMITS.headingMaxChars))
    .filter(Boolean)
    .slice(0, LIMITS.headingsMax);

  const parts: string[] = [];
  let total = 0;
  for (const el of Array.from(doc.querySelectorAll(TEXT_SELECTOR))) {
    if (total > LIMITS.visibleTextMaxChars) break;
    if (!outside(el) || el.querySelector(TEXT_SELECTOR) || !inViewport(el, win) || excluded(el, win)) continue;
    const t = ownText(el);
    if (!t) continue;
    parts.push(t);
    total += t.length + 1;
  }

  const lang = doc.documentElement.getAttribute("lang")?.trim().split(/[-_]/)[0]?.toLowerCase();

  return {
    url: win.location.href.slice(0, LIMITS.urlMaxChars),
    title: clean(doc.title).slice(0, LIMITS.titleMaxChars),
    lang: lang || null,
    headings,
    visibleText: parts.join("\n").slice(0, LIMITS.visibleTextMaxChars),
    product: findProduct(doc),
    kind: "other",
  };
}
