import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/preact";
import { boot } from "../src/boot";
import { detectConsent } from "../src/consent";
import type { WidgetConfig } from "../../src/shared/widget-protocol";
import { API, config } from "./fixtures";

type W = Window & { Concierge?: unknown };

function script() {
  const holder = document.createElement("div");
  holder.innerHTML = `<script src="${API}/widget.js" data-site="pk_test"></script>`;
  return holder.querySelector("script")!;
}

/** A window of our own: its own sessionStorage (to see every write) and consent-tool globals. */
function makeWin(extra: Record<string, unknown> = {}) {
  const data = new Map<string, string>();
  const store = {
    get length() {
      return data.size;
    },
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
  } as unknown as Storage;
  const props: PropertyDescriptorMap = { sessionStorage: { value: store } };
  for (const [k, v] of Object.entries(extra)) props[k] = { value: v, writable: true, configurable: true };
  const win = Object.create(window, props) as W;
  return { win, data };
}

const mounted = () => !!document.getElementById("concierge-root");

function stub(cfg: WidgetConfig) {
  vi.stubGlobal("fetch", async (u: string) =>
    String(u).includes("/config")
      ? new Response(JSON.stringify(cfg), { status: 200 })
      : new Response(JSON.stringify({ messages: [] }), { status: 200 }),
  );
}

beforeEach(() => {
  document.getElementById("concierge-root")?.remove();
  document.body.removeAttribute("data-cmplz");
  document.cookie = "cmplz_preferences=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});
afterEach(() => vi.unstubAllGlobals());

describe("detectConsent", () => {
  it("reads Complianz, Cookiebot and CookieYes", () => {
    expect(detectConsent(makeWin().win)).toEqual({ tool: null, granted: false });
    expect(detectConsent(makeWin({ cmplz_has_consent: (c: string) => c === "marketing" }).win)).toEqual({
      tool: "complianz",
      granted: true,
    });
    expect(detectConsent(makeWin({ Cookiebot: { consent: { preferences: false, marketing: false } } }).win)).toEqual({
      tool: "cookiebot",
      granted: false,
    });
    expect(
      detectConsent(makeWin({ getCkyConsent: () => ({ categories: { functional: true, advertisement: false } }) }).win),
    ).toEqual({ tool: "cookieyes", granted: true });
  });

  it("sees Complianz from its body marker before its script has loaded", () => {
    document.body.setAttribute("data-cmplz", "1");
    expect(detectConsent(makeWin().win)).toEqual({ tool: "complianz", granted: false });
    document.cookie = "cmplz_preferences=allow; path=/";
    expect(detectConsent(makeWin().win)).toEqual({ tool: "complianz", granted: true });
  });
});

describe("consent mode at boot", () => {
  it("required with no consent: nothing mounted, nothing stored; Concierge.consent(true) mounts it", async () => {
    stub({ ...config, consentMode: "required" });
    const { win, data } = makeWin();
    await boot(document, win, script());
    await new Promise((r) => setTimeout(r, 50));
    expect(mounted()).toBe(false);
    expect(data.size).toBe(0);
    (win.Concierge as { consent(g: boolean): void }).consent(true);
    await waitFor(() => expect(mounted()).toBe(true));
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });

  it("required: a queued consent call made before the script loaded counts", async () => {
    stub({ ...config, consentMode: "required" });
    const { win } = makeWin({ Concierge: { q: [["consent", true]] } });
    await boot(document, win, script());
    await waitFor(() => expect(mounted()).toBe(true));
  });

  it("required: consent from the site's banner mounts it", async () => {
    stub({ ...config, consentMode: "required" });
    let granted = false;
    const { win } = makeWin({ cmplz_has_consent: () => granted });
    await boot(document, win, script());
    expect(mounted()).toBe(false);
    granted = true;
    document.dispatchEvent(new Event("cmplz_status_change"));
    await waitFor(() => expect(mounted()).toBe(true));
  });

  it("auto with Complianz saying no: the chat is there but behaviour isn't tracked until consent", async () => {
    stub({ ...config, consentMode: "auto" });
    let granted = false;
    const { win, data } = makeWin({ cmplz_has_consent: () => granted });
    await boot(document, win, script());
    expect(mounted()).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(data.has("concierge.visit")).toBe(false);
    granted = true;
    document.dispatchEvent(new Event("cmplz_status_change"));
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });

  it("auto with Cookiebot preferences granted: tracking on", async () => {
    stub({ ...config, consentMode: "auto" });
    const { win, data } = makeWin({ Cookiebot: { consent: { preferences: true, marketing: false } } });
    await boot(document, win, script());
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });

  it("auto with no consent tool: tracking on, as before", async () => {
    stub({ ...config, consentMode: "auto" });
    const { win, data } = makeWin();
    await boot(document, win, script());
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });

  it("off ignores a tool that says no", async () => {
    stub({ ...config, consentMode: "off" });
    const { win, data } = makeWin({ cmplz_has_consent: () => false });
    await boot(document, win, script());
    await waitFor(() => expect(data.get("concierge.visit")).toBeTruthy());
  });
});
