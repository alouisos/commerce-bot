import { beforeEach, describe, expect, it } from "vitest";
import { collectPageContext } from "../src/page-context";

function visible(...els: Element[]) {
  for (const el of els) {
    el.getBoundingClientRect = () =>
      ({ top: 10, bottom: 50, left: 0, right: 100, width: 100, height: 40, x: 0, y: 10 }) as DOMRect;
  }
}

beforeEach(() => {
  document.head.innerHTML = "<title>My page</title>";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
});

describe("collectPageContext", () => {
  it("extracts a Product from a JSON-LD @graph", () => {
    document.head.innerHTML += `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "WebSite", name: "Shop" },
        { "@type": "Product", name: "Lamp", offers: { "@type": "Offer", price: "19.90", priceCurrency: "EUR" } },
      ],
    })}</script>`;
    const ctx = collectPageContext(document, window);
    expect(ctx.product).toEqual({ name: "Lamp", price: "19.90", currency: "EUR" });
    expect(ctx.title).toBe("My page");
  });

  it("truncates visible text to 4000 chars", () => {
    document.body.innerHTML = `<p>${"x".repeat(10000)}</p>`;
    visible(...document.querySelectorAll("p"));
    expect(collectPageContext(document, window).visibleText.length).toBe(4000);
  });

  it("only includes elements in the viewport", () => {
    document.body.innerHTML = "<p id=a>seen</p><p id=b>hidden</p>";
    visible(document.getElementById("a")!);
    expect(collectPageContext(document, window).visibleText).toBe("seen");
  });

  it("gives null lang when the page has none, and the primary subtag otherwise", () => {
    expect(collectPageContext(document, window).lang).toBeNull();
    document.documentElement.lang = "el-GR";
    expect(collectPageContext(document, window).lang).toBe("el");
  });

  it("excludes the widget's own text and form field values", () => {
    document.body.innerHTML =
      '<p id=a>public</p><div id="concierge-root"><p id=b>widget text</p></div><p id=c>x<textarea>secret</textarea></p><input value="typed secret">';
    visible(...document.querySelectorAll("p"));
    const text = collectPageContext(document, window).visibleText;
    expect(text).toContain("public");
    expect(text).not.toContain("widget text");
    expect(text).not.toContain("secret");
  });

  it("collects headings and truncates fields", () => {
    document.body.innerHTML = `<h1>${"h".repeat(500)}</h1><h2>Two</h2>`;
    const ctx = collectPageContext(document, window);
    expect(ctx.headings[0].length).toBe(200);
    expect(ctx.headings[1]).toBe("Two");
  });
});
