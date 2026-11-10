import { LIMITS, type PageContext, type PageKind } from "../../src/shared/widget-protocol";

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

function meta(doc: Document, property: string): string | null {
  return doc.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content?.trim().toLowerCase() || null;
}

function hasProductJsonLd(doc: Document): boolean {
  const nodes: Obj[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      flatten(JSON.parse(el.textContent ?? ""), nodes);
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return nodes.some(isProduct);
}

const CONTENT_MIN_WORDS = 300;

function wordCount(doc: Document): number {
  let n = 0;
  for (const el of Array.from(doc.querySelectorAll("p, li"))) {
    if (el.closest(WIDGET_ROOT)) continue;
    n += (el.textContent ?? "").split(/\s+/).filter(Boolean).length;
    if (n > CONTENT_MIN_WORDS) break;
  }
  return n;
}

/** What kind of page this is: WooCommerce/WordPress body classes first, then the URL, then Open Graph and text. */
export function detectPageKind(doc: Document, win: Window): PageKind {
  const body = doc.body?.classList;
  const has = (c: string) => !!body?.contains(c);
  const path = win.location.pathname.toLowerCase();
  if (has("woocommerce-checkout") || path.includes("/checkout")) return "checkout";
  if (has("woocommerce-cart") || /\/(cart|basket)\/?$/.test(path)) return "cart";
  if (has("single-product") || meta(doc, "og:type") === "product" || hasProductJsonLd(doc)) return "product";
  if (has("home") || path === "/") return "home";
  if (has("archive") || has("woocommerce-shop") || has("tax-product_cat")) return "listing";
  if (meta(doc, "og:type") === "article" || has("single-post") || wordCount(doc) > CONTENT_MIN_WORDS) return "content";
  return "other";
}

/** WooCommerce product pages often carry no Product JSON-LD; read the title and price from the page. */
function findWooProduct(doc: Document): PageContext["product"] {
  const title = doc.querySelector("h1.product_title") ?? doc.querySelector("h1");
  const name = title ? clean(title.textContent ?? "") : "";
  if (!name) return null;
  const priceEl =
    doc.querySelector(".summary .price .woocommerce-Price-amount") ?? doc.querySelector(".price");
  const price = priceEl ? clean(priceEl.textContent ?? "") || null : null;
  const symbol = priceEl?.querySelector(".woocommerce-Price-currencySymbol")?.textContent?.trim();
  return {
    name: name.slice(0, LIMITS.titleMaxChars),
    price: price && price.slice(0, 50),
    currency: symbol === "€" ? "EUR" : null,
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

  const kind = detectPageKind(doc, win);
  const product = findProduct(doc) ?? (kind === "product" ? findWooProduct(doc) : null);

  const lang = doc.documentElement.getAttribute("lang")?.trim().split(/[-_]/)[0]?.toLowerCase();

  return {
    url: win.location.href.slice(0, LIMITS.urlMaxChars),
    title: clean(doc.title).slice(0, LIMITS.titleMaxChars),
    lang: lang || null,
    headings,
    visibleText: parts.join("\n").slice(0, LIMITS.visibleTextMaxChars),
    product,
    kind,
  };
}
