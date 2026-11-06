import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/crawl/extract-page";

const html = (n: string) => readFileSync(`tests/fixtures/crawl/${n}`, "utf8");

describe("extractPage", () => {
  it("reads Yoast-style JSON-LD product data and strips chrome", () => {
    const p = extractPage(html("product-argan.html"), "https://shop.test/product/argan/");
    expect(p.product).toEqual({ name: "Argan Leave-In", price: "24.90", currency: "EUR", description: expect.any(String) });
    expect(p.title).toBe("Argan Leave-In");
    expect(p.text).toContain("Detangles and adds shine");
    expect(p.text).not.toContain("Footer menu text");
    expect(p.text).not.toContain("Menu stuff");
    expect(p.headings).toEqual(["Argan Leave-In", "How to use"]);
  });
  it("detects language", () => {
    expect(extractPage(html("el.html"), "https://shop.test/el/").language).toBe("el");
    expect(extractPage(html("ingredients.html"), "https://shop.test/ingredients/").language).toBe("en");
  });
  it("handles top-level, array and lowPrice product forms", () => {
    const wrap = (j: string) => `<html><head><script type="application/ld+json">${j}</script></head><body><p>x</p></body></html>`;
    const a = extractPage(wrap('{"@type":"Product","name":"A","offers":{"lowPrice":"5","priceCurrency":"USD"}}'), "https://s.test/a");
    expect(a.product).toMatchObject({ name: "A", price: "5", currency: "USD" });
    const b = extractPage(wrap('[{"@type":"Thing"},{"@type":["Product"],"name":"B"}]'), "https://s.test/b");
    expect(b.product).toMatchObject({ name: "B", price: null, currency: null });
    expect(extractPage(wrap("{not json"), "https://s.test/c").product).toBeNull();
  });
  it("falls back to body and then returns empty text for empty pages", () => {
    expect(extractPage("<html><body><p>Hello there</p></body></html>", "https://s.test/").text).toBe("Hello there");
    expect(extractPage("<html><body><script>x()</script></body></html>", "https://s.test/").text).toBe("");
  });
});
