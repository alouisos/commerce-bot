import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../src/boot";
import { API, config } from "./fixtures";
import { fireEvent, waitFor } from "@testing-library/preact";

type W = Window & { Concierge?: unknown };

function script(attrs = `src="${API}/widget.js" data-site="pk_test"`) {
  // Detached: happy-dom would try (and refuse) to load an attached script src.
  const holder = document.createElement("div");
  holder.innerHTML = `<script ${attrs}></script>`;
  return holder.querySelector("script")!;
}

beforeEach(() => {
  sessionStorage.clear();
  document.getElementById("concierge-root")?.remove();
  delete (window as W).Concierge;
});
afterEach(() => vi.unstubAllGlobals());

function stubConfig(cfg: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (u: string) => {
    calls.push(String(u));
    if (String(u).includes("/config")) return new Response(JSON.stringify(cfg), { status });
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  });
  return calls;
}

describe("boot", () => {
  it("mounts an open shadow root and fetches config with key and lang", async () => {
    document.documentElement.lang = "el";
    const calls = stubConfig(config);
    await boot(document, window, script());
    const host = document.getElementById("concierge-root")!;
    expect(host.shadowRoot).toBeTruthy();
    expect(calls[0]).toContain(`${API}/api/widget/config?key=pk_test`);
    expect(calls[0]).toContain("lang=el");
    expect(host.style.getPropertyValue("all")).toBe("initial");
    expect(host.style.getPropertyPriority("all")).toBe("important");
    const wrapper = host.shadowRoot!.querySelector(".cc") as HTMLElement;
    expect(wrapper.getAttribute("style") ?? "").toBeDefined();
    document.documentElement.lang = "";
  });

  it("replays the queued open call and replaces the global", async () => {
    stubConfig(config);
    const q: unknown[][] = [["open"]];
    (window as W).Concierge = { q };
    await boot(document, window, script());
    const host = document.getElementById("concierge-root")!;
    await waitFor(() => expect(host.shadowRoot!.querySelector('[role="dialog"]')).toBeTruthy());
    const api = (window as W).Concierge as { open(): void; close(): void; q?: unknown };
    expect(typeof api.open).toBe("function");
    expect(api.q).toBeUndefined();
  });

  it("renders nothing and warns once when config fails", async () => {
    stubConfig({}, 403);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot(document, window, script());
    expect(document.getElementById("concierge-root")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns and does nothing without data-site", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubConfig(config);
    await boot(document, window, script(`src="${API}/widget.js"`));
    expect(calls.length).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not mount twice", async () => {
    stubConfig(config);
    await boot(document, window, script());
    await boot(document, window, script());
    expect(document.querySelectorAll("#concierge-root").length).toBe(1);
  });

  it("tracks the visit even when suggestions are off (intent and pages for the admin)", async () => {
    stubConfig({ ...config, proactivity: "off" });
    // Its own storage: trackers left running by earlier tests write to the shared sessionStorage.
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as unknown as Storage;
    const win = Object.create(window, { sessionStorage: { value: store } }) as Window;
    await boot(document, win, script());
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });

  it("carries the email's cc_ref into every chat this visit", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), body: init?.body as string | undefined });
      if (String(u).includes("/config")) return new Response(JSON.stringify(config), { status: 200 });
      if (String(u).includes("/chat")) {
        return new Response('data: {"type":"start","cid":"c1"}\n\ndata: {"type":"done","messageId":"m","images":[]}\n\n', { status: 200 });
      }
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    const before = window.location.href;
    window.history.replaceState(null, "", "/product/shampoo/?cc_ref=abc123");
    try {
      await boot(document, window, script());
      const root = document.getElementById("concierge-root")!.shadowRoot!;
      fireEvent.click(root.querySelector('[aria-label="Open chat"]')!);
      await waitFor(() => expect(root.querySelector("textarea")).toBeTruthy());
      const ta = root.querySelector("textarea")!;
      fireEvent.input(ta, { target: { value: "hello" } });
      const send = root.querySelector(".send") as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      await waitFor(() => expect(calls.some((c) => c.url.includes("/chat"))).toBe(true));
      const body = JSON.parse(calls.find((c) => c.url.includes("/chat"))!.body!);
      expect(body.ref).toBe("abc123");
      expect(window.location.search).toBe("?cc_ref=abc123");
    } finally {
      window.history.replaceState(null, "", before);
    }
  });

  it("ignores a malformed cc_ref", async () => {
    stubConfig(config);
    const before = window.location.href;
    window.history.replaceState(null, "", "/?cc_ref=%3Cscript%3E");
    try {
      await boot(document, window, script());
      expect(sessionStorage.getItem("concierge.ref")).toBeNull();
    } finally {
      window.history.replaceState(null, "", before);
    }
  });
});
