import * as cheerio from "cheerio";

export type ExtractedPage = {
  url: string;
  title: string;
  language: string | null;
  headings: string[];
  text: string;
  product: { name: string; price: string | null; currency: string | null; description: string | null } | null;
};

const STRIP = "script, style, noscript, nav, header, footer, aside, form, iframe, svg";
const BLOCKS = "p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article, blockquote, pre, dt, dd, table";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function flatten(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) return node.forEach((n) => flatten(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  out.push(obj);
  if (obj["@graph"]) flatten(obj["@graph"], out);
}

function isProduct(o: Record<string, unknown>): boolean {
  const t = o["@type"];
  return t === "Product" || (Array.isArray(t) && t.includes("Product"));
}

function productFrom(nodes: Record<string, unknown>[]): ExtractedPage["product"] {
  const p = nodes.find(isProduct);
  const name = p && str(p.name);
  if (!p || !name) return null;
  const offers: Record<string, unknown>[] = [];
  flatten(p.offers, offers);
  let price: string | null = null;
  let currency: string | null = null;
  for (const o of offers) {
    const spec = o.priceSpecification as Record<string, unknown> | undefined;
    price = str(o.price) ?? str(o.lowPrice) ?? str(spec?.price);
    if (price) {
      currency = str(o.priceCurrency) ?? str(spec?.priceCurrency);
      break;
    }
  }
  return { name, price, currency, description: str(p.description) };
}

export function extractPage(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);

  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      flatten(JSON.parse($(el).text()), nodes);
    } catch {
      // ignore malformed JSON-LD
    }
  });
  const product = productFrom(nodes);

  const lang = $("html").attr("lang")?.trim().split(/[-_]/)[0]?.toLowerCase();
  const language = lang || null;
  const docTitle = clean($("head > title, title").first().text());

  $(STRIP).remove();
  let root = $("main").first();
  if (!root.length) root = $("article").first();
  if (!root.length) root = $("body").first();
  if (!root.length) root = $("html").first();

  const headings = root
    .find("h1, h2, h3")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean)
    .slice(0, 30);

  root.find(BLOCKS).each((_, el) => {
    $(el).append("\n");
  });
  const text = root
    .text()
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { url, title: docTitle || headings[0] || "", language, headings, text, product };
}
