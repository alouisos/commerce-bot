import { beforeEach, describe, expect, it } from "vitest";
import { collectPageContext, detectPageKind } from "../src/page-context";

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
  it("sends the page address without its query or fragment (they can hold order keys or reset links)", () => {
    const before = window.location.href;
    window.history.replaceState(null, "", "/checkout/order-received/12/?key=wc_order_SECRET1&cc_ref=abc#top");
    try {
      const ctx = collectPageContext(document, window);
      expect(ctx.url).toBe(`${window.location.origin}/checkout/order-received/12/`);
    } finally {
      window.history.replaceState(null, "", before);
    }
  });

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

  it("excludes contenteditable text", () => {
    document.body.innerHTML =
      '<p id=a>public</p><div contenteditable="true"><p id=b>typed draft</p></div><p id=c>ok <span contenteditable>inline typed</span></p><div contenteditable="false"><p id=d>readonly ok</p></div>';
    visible(...document.querySelectorAll("p"));
    const text = collectPageContext(document, window).visibleText;
    expect(text).toContain("public");
    expect(text).toContain("readonly ok");
    expect(text).not.toContain("typed");
  });

  it("excludes aria-hidden content, including headings", () => {
    document.body.innerHTML =
      '<h2 aria-hidden="true">hidden heading</h2><div aria-hidden="true"><h3>nested hidden</h3><p id=b>hidden para</p></div><h2>shown</h2><p id=a>seen</p>';
    visible(...document.querySelectorAll("p"));
    const ctx = collectPageContext(document, window);
    expect(ctx.headings).toEqual(["shown"]);
    expect(ctx.visibleText).toBe("seen");
  });

  it("excludes visibility:hidden and display:none content", () => {
    document.body.innerHTML =
      '<p id=a>seen</p><p id=b style="visibility:hidden">invisible</p><div style="display:none"><p id=c>gone</p></div><h2 style="visibility:hidden">hid</h2>';
    visible(...document.querySelectorAll("p"));
    const ctx = collectPageContext(document, window);
    expect(ctx.visibleText).toBe("seen");
    expect(ctx.headings).toEqual([]);
  });
});

describe("detectPageKind", () => {
  const at = (path: string) => window.history.replaceState(null, "", path);

  beforeEach(() => {
    document.body.className = "";
    at("/somewhere");
  });

  it("reads WooCommerce body classes", () => {
    document.body.className = "single-product woocommerce";
    expect(detectPageKind(document, window)).toBe("product");
    document.body.className = "woocommerce-cart";
    expect(detectPageKind(document, window)).toBe("cart");
    document.body.className = "woocommerce-checkout";
    expect(detectPageKind(document, window)).toBe("checkout");
    document.body.className = "home page";
    expect(detectPageKind(document, window)).toBe("home");
    document.body.className = "archive tax-product_cat";
    expect(detectPageKind(document, window)).toBe("listing");
  });

  it("falls back to the path and to page text", () => {
    at("/checkout/");
    expect(detectPageKind(document, window)).toBe("checkout");
    at("/checkout-2/");
    expect(detectPageKind(document, window)).toBe("checkout");
    at("/en/checkouts/abc");
    expect(detectPageKind(document, window)).toBe("checkout");
    at("/en/cart");
    expect(detectPageKind(document, window)).toBe("cart");
    at("/guide");
    document.body.innerHTML = `<p>${"word ".repeat(400)}</p>`;
    expect(detectPageKind(document, window)).toBe("content");
  });

  it("an empty page is other", () => {
    expect(detectPageKind(document, window)).toBe("other");
  });
});

describe("WooCommerce product without JSON-LD", () => {
  it("reads the product title and price from the page", () => {
    document.body.className = "single-product";
    document.body.innerHTML = `<h1 class="product_title">Shampoo</h1>
      <div class="summary"><p class="price"><span class="woocommerce-Price-amount amount"><bdi>22,00&nbsp;<span class="woocommerce-Price-currencySymbol">€</span></bdi></span></p></div>`;
    const ctx = collectPageContext(document, window);
    expect(ctx.kind).toBe("product");
    expect(ctx.product).toEqual({ name: "Shampoo", price: "22,00 €", currency: "EUR" });
  });
});
