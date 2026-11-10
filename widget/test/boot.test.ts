import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../src/boot";
import { API, config } from "./fixtures";
import { waitFor } from "@testing-library/preact";

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
});
