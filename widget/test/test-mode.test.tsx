/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../src/boot";
import { markConsentAsked, markTeased } from "../src/session";
import { App } from "../src/ui/App";
import { createVisitTracker, type VisitTracker } from "../src/visit";
import { API, config, mockFetch } from "./fixtures";
import type { ChatEvent, PromptOffer, WidgetConfig } from "../../src/shared/widget-protocol";

const KEY = "abcdefghijklmnopqrstuvwxyz012345";
const testConfig: WidgetConfig = { ...config, testMode: true };
const offer: PromptOffer = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "Want to know if it suits colour-treated hair?",
  question: "Does it suit colour-treated hair?",
};
const reply = (cid: string): ChatEvent[] => [
  { type: "start", cid },
  { type: "delta", text: "An answer" },
  { type: "done", messageId: `m-${Math.random()}`, images: [] },
];

type W = Window & { Concierge?: unknown };
let trackers: VisitTracker[] = [];
const home = window.location.href;

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.getElementById("concierge-root")?.remove();
  delete (window as W).Concierge;
});
afterEach(() => {
  cleanup();
  trackers.forEach((t) => t.dispose());
  trackers = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", home);
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function script() {
  const holder = document.createElement("div");
  holder.innerHTML = `<script src="${API}/widget.js" data-site="pk_test"></script>`;
  return holder.querySelector("script")!;
}

function stubConfig(cfg: WidgetConfig) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (u: string) => {
    calls.push(String(u));
    if (String(u).includes("/config")) return new Response(JSON.stringify(cfg), { status: 200 });
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  });
  return calls;
}

/** A product page scrolled to 60 %, so the visitor is "exploring". */
function productPage(path = "/product/shampoo/") {
  window.history.replaceState(null, "", path);
  document.body.className = "single-product";
  document.title = "Shampoo";
  Object.defineProperty(window, "scrollY", { configurable: true, value: 200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
}

function mount(cfg: WidgetConfig = testConfig, opts: { tracker?: boolean; reload?: () => void } = {}) {
  let tracker: VisitTracker | undefined;
  if (opts.tracker) {
    productPage();
    tracker = createVisitTracker({ doc: document, win: window, store: sessionStorage });
    trackers.push(tracker);
  }
  return render(
    <App config={cfg} apiBase={API} siteKey="pk_test" store={sessionStorage} tracker={tracker} reload={opts.reload} />,
  );
}

describe("turning test mode on", () => {
  it("stores the key from the address fragment, strips it, and sends it with the config request", async () => {
    window.history.replaceState(null, "", `/product/shampoo/?a=1#concierge-test=${KEY}`);
    const calls = stubConfig(config);
    await boot(document, window, script());
    expect(sessionStorage.getItem("concierge.test")).toBe(KEY);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/product/shampoo/?a=1");
    expect(calls[0]).toContain(`test=${KEY}`);
  });

  it("always takes a malformed key out of the address bar", async () => {
    window.history.replaceState(null, "", `/product/shampoo/#reviews&concierge-test=%E0${KEY}`);
    stubConfig(config);
    await boot(document, window, script());
    expect(window.location.hash).toBe("#reviews");
    expect(window.location.href).not.toContain("concierge-test");
    expect(sessionStorage.getItem("concierge.test")).toBeNull();
  });

  it("keeps the rest of the fragment", async () => {
    window.history.replaceState(null, "", `/product/shampoo/#reviews&concierge-test=${KEY}`);
    stubConfig(config);
    await boot(document, window, script());
    expect(sessionStorage.getItem("concierge.test")).toBe(KEY);
    expect(window.location.hash).toBe("#reviews");
  });

  it("later pages in the tab read the key from sessionStorage", async () => {
    sessionStorage.setItem("concierge.test", KEY);
    const calls = stubConfig(config);
    await boot(document, window, script());
    expect(calls[0]).toContain(`test=${KEY}`);
  });

  it("without a key nothing extra is sent", async () => {
    const calls = stubConfig(config);
    await boot(document, window, script());
    expect(calls[0]).not.toContain("test=");
    expect(sessionStorage.getItem("concierge.test")).toBeNull();
  });

  it("a stored key the server doesn't confirm is normal mode", async () => {
    sessionStorage.setItem("concierge.test", "forged");
    stubConfig({ ...config, testMode: false });
    await boot(document, window, script());
    const root = document.getElementById("concierge-root")!.shadowRoot!;
    fireEvent.click(root.querySelector('[aria-label="Open chat"]')!);
    await waitFor(() => expect(root.querySelector('[role="dialog"]')).toBeTruthy());
    expect(root.querySelector(".test-tag")).toBeNull();
  });
});

describe("in test mode", () => {
  beforeEach(() => sessionStorage.setItem("concierge.test", KEY));

  it("the greeting shows on every page load", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch({}).fn);
    markTeased(sessionStorage);
    mount();
    await advance(1_400);
    expect(screen.queryByText(testConfig.greeting.message)).toBeNull();
    await advance(200);
    expect(screen.getByText(testConfig.greeting.message)).toBeTruthy();
    cleanup();
    mount();
    await advance(1_600);
    expect(screen.getByText(testConfig.greeting.message)).toBeTruthy();
  });

  it("normal mode still greets once per visit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch({}).fn);
    markTeased(sessionStorage);
    mount(config);
    await advance(5_000);
    expect(screen.queryByText(config.greeting.message)).toBeNull();
  });

  it("asks for the email after the first reply, even if already asked this visit", async () => {
    const m = mockFetch({ chat: reply("c1") });
    vi.stubGlobal("fetch", m.fn);
    markConsentAsked(sessionStorage);
    mount({ ...testConfig, emailCapture: true });
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByText(testConfig.strings.consentAsk);
    const chat = JSON.parse(String(m.calls.find((c) => c.url.pathname.endsWith("/chat"))!.init!.body));
    expect(chat.test).toBe(KEY);
  });

  it("once answered, the email ask stays closed for that conversation on later pages; a new one asks again", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        chat: reply("c1"),
        conversation: { messages: [{ id: "m1", role: "visitor", content: "first", images: [], kind: "chat" }, { id: "m2", role: "bot", content: "An answer", images: [], kind: "chat" }] },
      }).fn,
    );
    const cfg = { ...testConfig, emailCapture: true };
    mount(cfg);
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByText(cfg.strings.consentAsk);
    fireEvent.click(screen.getByText(cfg.strings.consentNo));
    expect(screen.queryByText(cfg.strings.consentAsk)).toBeNull();

    // Next page, same conversation (restored from the server): not asked again.
    cleanup();
    mount(cfg);
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getAllByText("An answer").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(cfg.strings.consentAsk)).toBeNull();

    // A new conversation asks again.
    cleanup();
    sessionStorage.removeItem("concierge.cid");
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c2") }).fn);
    mount(cfg);
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const ta2 = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta2, { target: { value: "again" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByText(cfg.strings.consentAsk);
  });

  it("the email ask still needs the site to be able to send email", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c1") }).fn);
    mount({ ...testConfig, emailCapture: false });
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getAllByText("An answer").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(testConfig.strings.consentAsk)).toBeNull();
  });

  it("opening the chat doesn't silence suggestions; they come after 3 s and again on the next load", async () => {
    vi.useFakeTimers();
    const m = mockFetch({ prompt: offer });
    vi.stubGlobal("fetch", m.fn);
    const promptCalls = () => m.calls.filter((c) => c.url.pathname.endsWith("/prompt"));
    mount(testConfig, { tracker: true });
    fireEvent.click(screen.getByLabelText("Open chat"));
    fireEvent.click(screen.getByLabelText("Open chat"));
    await advance(1_600);
    fireEvent.pointerDown(document.body); // the greeting goes away on the first click elsewhere
    await advance(900);
    expect(promptCalls()).toHaveLength(0);
    await advance(1_000);
    expect(promptCalls()).toHaveLength(1);
    expect(JSON.parse(String(promptCalls()[0].init!.body)).test).toBe(KEY);
    await advance(10);
    expect(screen.getByText(offer.text)).toBeTruthy();
    const events = m.calls.filter((c) => c.url.pathname.endsWith("/prompt-event"));
    expect(JSON.parse(String(events[0].init!.body))).toMatchObject({ event: "shown", test: KEY });

    // Dismissing doesn't end them either, and reloading the same page asks again.
    fireEvent.click(screen.getByLabelText("Dismiss suggestion"));
    cleanup();
    trackers.forEach((t) => t.dispose());
    mount(testConfig, { tracker: true });
    await advance(1_600);
    fireEvent.pointerDown(document.body); // the greeting goes away on the first click elsewhere
    await advance(4_000);
    expect(promptCalls()).toHaveLength(2);
  });

  it("the greeting doesn't hold a suggestion back: the suggestion takes its place", async () => {
    vi.useFakeTimers();
    const m = mockFetch({ prompt: offer });
    vi.stubGlobal("fetch", m.fn);
    mount(testConfig, { tracker: true });
    await advance(1_600);
    expect(screen.getByText(testConfig.greeting.message)).toBeTruthy();
    await advance(2_000);
    expect(m.calls.filter((c) => c.url.pathname.endsWith("/prompt"))).toHaveLength(1);
    await advance(10);
    expect(screen.getByText(offer.text)).toBeTruthy();
    expect(screen.queryByText(testConfig.greeting.message)).toBeNull();
  });

  it("shows a TEST MODE tag and Exit clears the key and reloads", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    const reload = vi.fn();
    mount(testConfig, { reload });
    fireEvent.click(screen.getByLabelText("Open chat"));
    const dialog = await screen.findByRole("dialog");
    const tag = dialog.querySelector(".test-tag");
    expect(tag?.textContent).toBe("TEST MODE");
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(sessionStorage.getItem("concierge.test")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("normal mode", () => {
  it("has no tag, and requests carry no test field", async () => {
    sessionStorage.setItem("concierge.test", KEY); // not confirmed by the server
    const m = mockFetch({ chat: reply("c1") });
    vi.stubGlobal("fetch", m.fn);
    mount(config);
    fireEvent.click(screen.getByLabelText("Open chat"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".test-tag")).toBeNull();
    expect(screen.queryByRole("button", { name: "Exit" })).toBeNull();
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(m.calls.some((c) => c.url.pathname.endsWith("/chat"))).toBe(true));
    const chat = JSON.parse(String(m.calls.find((c) => c.url.pathname.endsWith("/chat"))!.init!.body));
    expect("test" in chat).toBe(false);
  });
});
