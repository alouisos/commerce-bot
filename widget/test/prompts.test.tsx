/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { markTeased } from "../src/session";
import { createVisitTracker, type VisitTracker } from "../src/visit";
import { API, config, mockFetch } from "./fixtures";
import type { ChatEvent, PromptOffer, WidgetConfig } from "../../src/shared/widget-protocol";

const offer: PromptOffer = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "Want to know if it suits colour-treated hair?",
  question: "Does it suit colour-treated hair?",
};

let trackers: VisitTracker[] = [];

/** A product page, scrolled to 60 %: exploring at 0.7 once 15 s have passed. */
function productPage(path = "/product/shampoo/", bodyClass = "single-product") {
  window.history.replaceState(null, "", path);
  document.body.className = bodyClass;
  document.title = "Shampoo";
  Object.defineProperty(window, "scrollY", { configurable: true, value: 200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
}

function mount(cfg: Partial<WidgetConfig> = {}, path?: string, bodyClass?: string, store: Storage = sessionStorage) {
  productPage(path, bodyClass);
  const tracker = createVisitTracker({ doc: document, win: window, store });
  trackers.push(tracker);
  return render(<App config={{ ...config, ...cfg }} apiBase={API} siteKey="pk_test" store={store} tracker={tracker} />);
}

function remount(cfg: Partial<WidgetConfig> = {}, path?: string, bodyClass?: string) {
  cleanup();
  trackers.forEach((t) => t.dispose());
  trackers = [];
  return mount(cfg, path, bodyClass);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup(prompt: PromptOffer | null = offer, chat: ChatEvent[] = [{ type: "start", cid: "c1" }]) {
  const m = mockFetch({ prompt, chat });
  vi.stubGlobal("fetch", vi.fn(m.fn));
  const promptCalls = () => m.calls.filter((c) => c.url.pathname.endsWith("/prompt"));
  const events = () =>
    m.calls
      .filter((c) => c.url.pathname.endsWith("/prompt-event"))
      .map((c) => (JSON.parse(String(c.init?.body)) as { event: string }).event);
  const chats = () =>
    m.calls
      .filter((c) => c.url.pathname.endsWith("/chat"))
      .map((c) => JSON.parse(String(c.init?.body)) as { message: string; promptId?: string | null; visit?: unknown });
  const eventCalls = () => m.calls.filter((c) => c.url.pathname.endsWith("/prompt-event"));
  return { promptCalls, events, chats, eventCalls };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  markTeased(sessionStorage); // the greeting already showed this visit
  document.body.innerHTML = "";
});
afterEach(() => {
  cleanup();
  trackers.forEach((t) => t.dispose());
  trackers = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("suggestions", () => {
  it("waits for the page delay", async () => {
    const f = setup();
    mount();
    await advance(14_000);
    expect(f.promptCalls()).toHaveLength(0);
    await advance(2_000);
    expect(f.promptCalls()).toHaveLength(1);
  });

  it("never asks while the visitor is scrolling", async () => {
    const f = setup();
    mount();
    await advance(14_500);
    window.dispatchEvent(new Event("scroll"));
    await advance(1_500);
    expect(f.promptCalls()).toHaveLength(0);
    await advance(1_000);
    expect(f.promptCalls()).toHaveLength(1);
  });

  it("asks for nothing when suggestions are off, AI is unavailable, or on checkout", async () => {
    const f = setup();
    mount({ proactivity: "off" });
    await advance(30_000);
    remount({ mode: "fallback" }, "/product/other/");
    await advance(30_000);
    cleanup();
    mount({}, "/checkout/", "woocommerce-checkout");
    await advance(30_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("opening the chat doesn't silence: a suggestion can still appear later on another page", async () => {
    const f = setup();
    mount();
    fireEvent.click(screen.getByLabelText("Open chat"));
    fireEvent.click(screen.getByLabelText("Open chat"));
    remount({}, "/product/conditioner/");
    await advance(20_000);
    expect(f.promptCalls()).toHaveLength(1);
    expect(screen.getByText(offer.text)).toBeTruthy();
  });

  it("stays quiet after the greeting was closed with ×", async () => {
    const f = setup();
    sessionStorage.clear();
    mount();
    await advance(1_600);
    fireEvent.click(screen.getByLabelText("Close chat"));
    await advance(30_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("shows a suggestion without taking focus and reports it", async () => {
    const f = setup();
    mount();
    await advance(20_000);
    expect(screen.getByText(offer.text)).toBeTruthy();
    expect(f.events()).toEqual(["shown"]);
    expect(document.activeElement).toBe(document.body);
    const req = JSON.parse(String(f.promptCalls()[0].init?.body)) as { intent: string; confidence: number };
    expect(req).toMatchObject({ intent: "exploring", confidence: 0.7 });
    expect(req).not.toHaveProperty("cid");
  });

  it("tapping opens the chat and asks the suggestion's question", async () => {
    const f = setup();
    mount();
    await advance(20_000);
    fireEvent.click(screen.getByText(offer.text));
    await advance(10);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(f.chats()).toHaveLength(1);
    expect(f.chats()[0]).toMatchObject({ message: offer.question, promptId: offer.id });
    expect(f.chats()[0].visit).toMatchObject({ intent: "exploring" });
    expect(f.events()).toEqual(["shown", "tapped"]);
  });

  it("× dismisses for the rest of the visit, across page loads", async () => {
    const f = setup();
    mount();
    await advance(20_000);
    fireEvent.click(screen.getByLabelText("Dismiss suggestion"));
    expect(screen.queryByText(offer.text)).toBeNull();
    expect(f.events()).toEqual(["shown", "dismissed"]);
    remount({}, "/product/conditioner/");
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(1);
  });

  it("an ignored suggestion hides itself after 20 s, or on a scroll once it has been up 10 s, without a dismissal", async () => {
    const f = setup();
    mount();
    await advance(16_000);
    expect(screen.getByText(offer.text)).toBeTruthy();
    await advance(20_000);
    expect(screen.queryByText(offer.text)).toBeNull();
    remount({}, "/product/conditioner/");
    await advance(70_000);
    expect(screen.getByText(offer.text)).toBeTruthy();
    await advance(10_500);
    window.dispatchEvent(new Event("scroll"));
    await advance(10);
    expect(screen.queryByText(offer.text)).toBeNull();
    expect(f.events()).toEqual(["shown", "shown"]);
  });

  it("stays up for its first 10 s even while the visitor scrolls", async () => {
    setup();
    mount();
    for (let i = 0; i < 40 && !screen.queryByText(offer.text); i++) await advance(500);
    expect(screen.getByText(offer.text)).toBeTruthy();
    window.dispatchEvent(new Event("scroll"));
    await advance(4_000);
    window.dispatchEvent(new Event("scroll"));
    await advance(4_000);
    window.dispatchEvent(new Event("scroll"));
    await advance(10);
    expect(screen.getByText(offer.text)).toBeTruthy();
    await advance(2_500);
    window.dispatchEvent(new Event("scroll"));
    await advance(10);
    expect(screen.queryByText(offer.text)).toBeNull();
  });

  it("at most two per visit on gentle, one request per page", async () => {
    const f = setup();
    mount();
    await advance(90_000);
    remount({}, "/product/b/");
    await advance(90_000);
    remount({}, "/product/c/");
    await advance(90_000);
    expect(f.promptCalls()).toHaveLength(2);
    expect(f.events()).toEqual(["shown", "shown"]);
  });

  it("no suggestion for a page is not asked again on that page", async () => {
    const f = setup(null);
    mount();
    await advance(60_000);
    expect(f.promptCalls()).toHaveLength(1);
    expect(f.events()).toEqual([]);
  });
});

const answer = (cid = "c1"): ChatEvent[] => [
  { type: "start", cid },
  { type: "delta", text: "An answer" },
  { type: "done", messageId: `m-${Math.random()}`, images: [] },
];

/** Opens the panel and sends one message; the panel stays open. */
async function say(text = "Is it sulfate-free?") {
  if (!screen.queryByRole("dialog")) fireEvent.click(screen.getByLabelText("Open chat"));
  fireEvent.input(screen.getByPlaceholderText("Type a message"), { target: { value: text } });
  fireEvent.click(screen.getByLabelText("Send"));
  await advance(50);
}

function closePanel() {
  fireEvent.click(screen.getByLabelText("Close chat"));
}

const CART: [string, string] = ["/cart/", "woocommerce-cart"];

describe("after the visitor chatted", () => {
  it("offers one suggestion, on another page, 30 s after the chat closed, to a visitor ready to buy, with the cid", async () => {
    const f = setup(offer, answer());
    mount();
    await say();
    closePanel();
    remount({}, ...CART);
    await advance(29_000);
    expect(f.promptCalls()).toHaveLength(0);
    await advance(2_000);
    expect(f.promptCalls()).toHaveLength(1);
    const req = JSON.parse(String(f.promptCalls()[0].init?.body)) as { intent: string; cid?: string };
    expect(req).toMatchObject({ intent: "buying", cid: "c1" });
    await advance(10);
    expect(screen.getByText(offer.text)).toBeTruthy();
    expect(f.events()).toEqual(["shown"]);
  });

  it("at most one after the chat", async () => {
    const f = setup(offer, answer());
    mount();
    await say();
    closePanel();
    remount({}, ...CART);
    await advance(60_000);
    cleanup();
    mount({}, "/basket/", "woocommerce-cart");
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(1);
    expect(f.events()).toEqual(["shown"]);
  });

  it("none on the page where the visitor chatted", async () => {
    const f = setup(offer, answer());
    mount({}, ...CART);
    await say();
    closePanel();
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("none while the panel hasn't been closed since chatting", async () => {
    const f = setup(offer, answer());
    mount();
    await say();
    remount({}, ...CART);
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("none unless the visitor is ready to buy", async () => {
    const f = setup(offer, answer());
    mount();
    await say();
    closePanel();
    remount({}, "/product/conditioner/");
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("tapping a suggestion isn't a no: the post-chat door stays open", async () => {
    const f = setup(offer, answer());
    mount();
    await advance(20_000);
    fireEvent.click(screen.getByText(offer.text));
    await advance(50);
    closePanel();
    remount({}, ...CART);
    await advance(40_000);
    expect(f.promptCalls()).toHaveLength(2);
    expect(f.events()).toEqual(["shown", "tapped", "shown"]);
  });

  it("No to the email ask silences suggestions", async () => {
    const f = setup(offer, answer());
    mount({ emailCapture: true });
    await say("one");
    await say("two");
    await say("three");
    fireEvent.click(screen.getByText(config.strings.consentNo));
    closePanel();
    remount({ emailCapture: true }, ...CART);
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(0);
  });

  it("in a test tab the after-chat limits don't apply, and the request carries the cid", async () => {
    sessionStorage.setItem("concierge.test", "abcdefghijklmnopqrstuvwxyz012345");
    const f = setup(offer, answer());
    mount({ testMode: true });
    await say();
    closePanel();
    await advance(1_600);
    fireEvent.pointerDown(document.body); // the greeting goes away on the first click elsewhere
    await advance(10_000);
    expect(f.promptCalls()).toHaveLength(1);
    const req = JSON.parse(String(f.promptCalls()[0].init?.body)) as { intent: string; cid?: string };
    expect(req).toMatchObject({ intent: "exploring", cid: "c1" });
  });
});
