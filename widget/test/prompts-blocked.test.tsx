/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { markTeased } from "../src/session";
import { createVisitTracker, type VisitTracker } from "../src/visit";
import { API, config, mockFetch } from "./fixtures";
import type { PromptOffer, WidgetConfig } from "../../src/shared/widget-protocol";

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


async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup(prompt: PromptOffer | null = offer, chat = [{ type: "start" as const, cid: "c1" }]) {
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

// Its own file: session.ts keeps per-page memory state at module level, as a real page load starts fresh.
describe("suggestions with site data blocked", () => {
  it("with site data blocked (storage that silently drops writes), × still ends suggestions", async () => {
    const f = setup();
    // What boot falls back to when reading sessionStorage throws.
    const dropping = { getItem: () => null, setItem: () => {} } as unknown as Storage;
    mount({}, undefined, undefined, dropping);
    // The greeting can't be remembered as shown either; it goes on the first scroll.
    await advance(4_000);
    expect(screen.getByText("Hi, ask me anything")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await advance(20_000);
    fireEvent.click(screen.getByLabelText("Dismiss suggestion"));
    await advance(120_000);
    expect(f.promptCalls()).toHaveLength(1);
    const sids = new Set(
      [...f.promptCalls(), ...f.eventCalls()].map((c) => (JSON.parse(String(c.init?.body)) as { sid: string }).sid),
    );
    expect(sids.size).toBe(1);
  });
});
