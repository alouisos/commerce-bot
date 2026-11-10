import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/preact";
import { boot } from "../src/boot";
import { detectOrderConfirmation } from "../src/orders";
import type { WidgetConfig } from "../../src/shared/widget-protocol";
import { API, config } from "./fixtures";

type W = Window & { Concierge?: unknown };

function script() {
  const holder = document.createElement("div");
  holder.innerHTML = `<script src="${API}/widget.js" data-site="pk_test"></script>`;
  return holder.querySelector("script")!;
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    store: {
      get length() {
        return data.size;
      },
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
    } as unknown as Storage,
  };
}

function winWith(store: Storage, extra: Record<string, unknown> = {}) {
  const props: PropertyDescriptorMap = { sessionStorage: { value: store } };
  for (const [k, v] of Object.entries(extra)) props[k] = { value: v, writable: true, configurable: true };
  return Object.create(window, props) as W;
}

let before = "";
let orders: { url: string; body: Record<string, unknown> }[] = [];
function stub(cfg: WidgetConfig) {
  orders = [];
  vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
    const url = String(u);
    if (url.includes("/config")) return new Response(JSON.stringify(cfg), { status: 200 });
    if (url.includes("/order")) {
      orders.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  });
}

function page(path: string, html = "") {
  window.history.replaceState(null, "", path);
  document.body.className = "";
  document.querySelectorAll("[data-test-page]").forEach((n) => n.remove());
  if (html) {
    const div = document.createElement("div");
    div.setAttribute("data-test-page", "");
    div.innerHTML = html;
    document.body.appendChild(div);
  }
}

beforeEach(() => {
  before = window.location.href;
  document.getElementById("concierge-root")?.remove();
});
afterEach(() => {
  window.history.replaceState(null, "", before);
  document.querySelectorAll("[data-test-page]").forEach((n) => n.remove());
  document.body.className = "";
  vi.unstubAllGlobals();
});

describe("detectOrderConfirmation", () => {
  it("reads WooCommerce's order-received page", () => {
    page("/checkout/order-received/1234/?key=wc_order_AbC123xyz");
    expect(detectOrderConfirmation(document, window)).toEqual({ orderId: "1234", orderKey: "wc_order_AbC123xyz" });
  });

  it("drops a malformed order key", () => {
    page("/checkout/order-received/1234/?key=%3Cscript%3E");
    expect(detectOrderConfirmation(document, window)).toEqual({ orderId: "1234", orderKey: null });
  });

  it("recognises WooCommerce by its body class even on a custom path", () => {
    page("/ευχαριστουμε/");
    document.body.classList.add("woocommerce-order-received");
    expect(detectOrderConfirmation(document, window)).toEqual({ orderId: null, orderKey: null });
  });

  it("recognises a generic thank-you page only when it talks about an order", () => {
    page("/thank-you/", "<h1>Thank you for your order</h1>");
    expect(detectOrderConfirmation(document, window)).toEqual({ orderId: null, orderKey: null });
    page("/thank-you/", "<h1>Ευχαριστούμε για την παραγγελία σας</h1>");
    expect(detectOrderConfirmation(document, window)).not.toBeNull();
    page("/thank-you/", "<h1>Thanks for subscribing</h1>");
    expect(detectOrderConfirmation(document, window)).toBeNull();
    page("/product/shampoo/", "<h1>Shampoo</h1>");
    expect(detectOrderConfirmation(document, window)).toBeNull();
  });
});

describe("the order beacon", () => {
  it("is sent once per page and visit, with the visit and the order", async () => {
    stub({ ...config, consentMode: "off" });
    page("/checkout/order-received/1234/?key=wc_order_AbC123xyz");
    const { store } = memoryStore();
    store.setItem("concierge.ref", "abc123");
    await boot(document, winWith(store), script());
    await waitFor(() => expect(orders).toHaveLength(1));
    expect(new URL(orders[0].url).searchParams.get("key")).toBe("pk_test");
    expect(orders[0].body).toMatchObject({
      key: "pk_test",
      url: `${window.location.origin}/checkout/order-received/1234/`,
      orderId: "1234",
      orderKey: "wc_order_AbC123xyz",
      ref: "abc123",
    });
    expect(typeof orders[0].body.sid).toBe("string");

    // A reload of the same page in the same visit sends nothing.
    document.getElementById("concierge-root")?.remove();
    await boot(document, winWith(store), script());
    await new Promise((r) => setTimeout(r, 50));
    expect(orders).toHaveLength(1);
  });

  it("isn't sent while the site's cookie banner refuses tracking", async () => {
    stub({ ...config, consentMode: "auto" });
    page("/checkout/order-received/1234/?key=wc_order_AbC123xyz");
    const { store } = memoryStore();
    await boot(document, winWith(store, { cmplz_has_consent: () => false }), script());
    await new Promise((r) => setTimeout(r, 50));
    expect(orders).toHaveLength(0);
  });

  it("isn't sent on an ordinary page", async () => {
    stub({ ...config, consentMode: "off" });
    page("/product/shampoo/", "<h1>Shampoo</h1>");
    await boot(document, winWith(memoryStore().store), script());
    await new Promise((r) => setTimeout(r, 50));
    expect(orders).toHaveLength(0);
  });
});
