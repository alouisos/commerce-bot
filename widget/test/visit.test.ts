import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisitTracker } from "../src/visit";

let clock = 0;
const now = () => clock;

function setScroll(y: number, height = 3000, viewport = 1000) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: height });
}

function scrollTo(y: number) {
  setScroll(y);
  window.dispatchEvent(new Event("scroll"));
}

async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    clock += 1000;
    await vi.advanceTimersByTimeAsync(1000);
  }
}

function visibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  sessionStorage.clear();
  document.body.className = "single-product";
  document.body.innerHTML = "<h1 class='product_title'>Shampoo</h1>";
  document.title = "Shampoo";
  window.history.replaceState(null, "", "/product/shampoo/?utm=x");
  visibility("visible");
  setScroll(0);
});
afterEach(() => vi.useRealTimers());

describe("visit tracker", () => {
  it("counts seconds only while the page is visible", async () => {
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    await tick(20);
    expect(t.signals().seconds).toBe(20);
    visibility("hidden");
    await tick(5);
    expect(t.signals().seconds).toBe(20);
    t.dispose();
  });

  it("tracks scroll depth, recent scrolling and skimming", async () => {
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    expect(t.lastScrollAt()).toBeNull();
    scrollTo(2000);
    expect(t.signals().maxScroll).toBe(1);
    expect(t.lastScrollAt()).toBe(clock);
    expect(t.signals().fastScroll).toBe(false);
    for (let i = 0; i < 10; i++) {
      clock += 200;
      scrollTo(i % 2 ? 0 : 2000);
    }
    expect(t.signals().fastScroll).toBe(true);
    await tick(5);
    expect(t.signals().fastScroll).toBe(false);
    t.dispose();
  });

  it("notices add to cart", () => {
    document.body.innerHTML += `<form><button class="single_add_to_cart_button" type="button">Add</button></form>`;
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    document.querySelector<HTMLButtonElement>(".single_add_to_cart_button")!.click();
    expect(t.signals().addedToCart).toBe(true);
    expect(t.summary().addedToCart).toBe(true);
    t.dispose();
  });

  it("remembers the visit across page loads; a reload is not a return visit", async () => {
    const first = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    await tick(3);
    first.dispose();
    const reload = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    expect(reload.signals()).toMatchObject({ pageKind: "product", revisitedProduct: false, productPages: 1, seconds: 0 });
    expect(reload.summary().pages.map((p) => p.url)).toEqual([
      "http://localhost:3000/product/shampoo/",
      "http://localhost:3000/product/shampoo/",
    ]);
    reload.dispose();
  });

  it("coming back to a product after another page is a return visit", () => {
    createVisitTracker({ doc: document, win: window, store: sessionStorage, now }).dispose();
    window.history.replaceState(null, "", "/product/conditioner/");
    createVisitTracker({ doc: document, win: window, store: sessionStorage, now }).dispose();
    window.history.replaceState(null, "", "/product/shampoo/");
    const back = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    expect(back.signals()).toMatchObject({ revisitedProduct: true, productPages: 2 });
    createVisitTracker({ doc: document, win: window, store: sessionStorage, now }).dispose(); // and a reload of it
    back.dispose();
    const again = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    expect(again.signals().revisitedProduct).toBe(true);
    again.dispose();
  });

  it("an in-page link (#reviews) is the same page view", async () => {
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    await tick(10);
    window.history.pushState(null, "", "/product/shampoo/#reviews");
    window.dispatchEvent(new Event("popstate"));
    await tick(25);
    expect(t.signals()).toMatchObject({ seconds: 35, revisitedProduct: false });
    expect(t.summary().pages).toHaveLength(1);
    expect(t.summary().intent).toBe("exploring");
    t.dispose();
  });

  it("a URL change without reload starts a new page view", async () => {
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    await tick(4);
    document.body.className = "woocommerce-cart";
    window.history.pushState(null, "", "/cart/");
    await tick(1);
    expect(t.pageKind()).toBe("cart");
    expect(t.signals()).toMatchObject({ cartSeen: true, seconds: 0 });
    expect(t.pageStartedAt()).toBe(clock);
    t.dispose();
  });

  it("keeps at most 10 pages in the summary", () => {
    for (let i = 0; i < 15; i++) {
      window.history.replaceState(null, "", `/p/${i}`);
      createVisitTracker({ doc: document, win: window, store: sessionStorage, now }).dispose();
    }
    const t = createVisitTracker({ doc: document, win: window, store: sessionStorage, now });
    expect(t.summary().pages.length).toBe(10);
    t.dispose();
  });

  it("works when storage throws", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const t = createVisitTracker({ doc: document, win: window, store: broken, now });
    await tick(16);
    expect(t.signals()).toMatchObject({ pageKind: "product", seconds: 16 });
    expect(t.summary().intent).toBe("exploring");
    t.dispose();
  });
});
