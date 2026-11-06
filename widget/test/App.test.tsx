/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { API, config, mockFetch } from "./fixtures";
import type { WidgetConfig } from "../../src/shared/widget-protocol";

function mount(cfg: WidgetConfig = config, register?: (a: { open(): void; close(): void }) => void) {
  return render(<App config={cfg} apiBase={API} siteKey="pk_test" store={sessionStorage} register={register} />);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openPanel() {
  fireEvent.click(screen.getByLabelText("Open chat"));
  return screen.findByRole("dialog");
}

async function send(text: string) {
  const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value: text } });
  fireEvent.keyDown(ta, { key: "Enter" });
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.style.cssText = "";
  document.documentElement.style.cssText = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("teaser", () => {
  it("appears after 1.5s, dismisses on scroll, and never reappears this session", async () => {
    vi.useFakeTimers();
    mount();
    expect(screen.queryByText("Hi, ask me anything")).toBeNull();
    await advance(1500);
    expect(screen.getByText("Hi, ask me anything")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText("Hi, ask me anything")).toBeNull();
    cleanup();
    mount();
    await advance(5000);
    expect(screen.queryByText("Hi, ask me anything")).toBeNull();
  });

  it("never moves focus", async () => {
    vi.useFakeTimers();
    const before = document.activeElement;
    mount();
    await advance(1500);
    expect(screen.getByText("Hi, ask me anything")).toBeTruthy();
    expect(document.activeElement).toBe(before);
  });

  it("removes its window listeners on dismiss", async () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    mount();
    await advance(1500);
    const types = ["scroll", "pointerdown", "keydown"];
    for (const t of types) {
      expect(add.mock.calls.some((c) => c[0] === t && (c[2] as AddEventListenerOptions)?.once && (c[2] as AddEventListenerOptions)?.passive)).toBe(true);
    }
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    for (const t of types) expect(remove.mock.calls.some((c) => c[0] === t)).toBe(true);
  });

  it("pointerdown then click on the teaser opens the panel; pointerdown elsewhere still dismisses", async () => {
    vi.useFakeTimers();
    mount();
    await advance(1500);
    const t = screen.getByText("Hi, ask me anything").closest("button")!;
    await act(async () => {
      t.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    });
    expect(screen.getByText("Hi, ask me anything")).toBeTruthy();
    fireEvent.click(t);
    expect(screen.getByRole("dialog")).toBeTruthy();
    cleanup();
    sessionStorage.clear();
    mount();
    await advance(1500);
    await act(async () => {
      t.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(screen.queryByText("Hi, ask me anything")).toBeNull();
  });

  it("clicking it opens the panel", async () => {
    vi.useFakeTimers();
    mount();
    await advance(1500);
    fireEvent.click(screen.getByText("Hi, ask me anything"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("panel", () => {
  it("opens with the textarea focused, shows the disclosure, and Escape returns focus to the launcher", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount();
    const launcher = screen.getByLabelText("Open chat");
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(launcher.querySelector("svg")).toBeTruthy();
    const dialog = await openPanel();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(config.strings.disclosure)).toBeTruthy();
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    expect(ta.getAttribute("maxlength")).toBe("2000");
    await waitFor(() => expect(document.activeElement).toBe(ta));
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("traps Tab inside the panel", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount();
    const dialog = await openPanel();
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, textarea, a[href]")).filter(
      (e) => !(e as HTMLButtonElement).disabled,
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("sends, shows typing, streams text and announces the completed message", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const enc = new TextEncoder();
    const m = mockFetch({
      chat: () =>
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(enc.encode('data: {"type":"start","cid":"c1"}\n\ndata: {"type":"delta","text":"Hel"}\n\n'));
              await gate;
              c.enqueue(enc.encode('data: {"type":"delta","text":"lo **you**"}\n\ndata: {"type":"done","messageId":"m1","images":[]}\n\n'));
              c.close();
            },
          }),
          { status: 200 },
        ),
    });
    vi.stubGlobal("fetch", m.fn);
    mount();
    await openPanel();
    await send("hi there");
    expect(screen.getByText("hi there")).toBeTruthy();
    await screen.findByText("Hel");
    expect(screen.getByTestId("typing")).toBeTruthy();
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).not.toContain("Hel");
    finish();
    await waitFor(() => expect(live.textContent).toContain("Hello you"));
    expect(live.querySelector("strong")!.textContent).toBe("you");
    expect(screen.queryByTestId("typing")).toBeNull();
    expect(sessionStorage.getItem("concierge.cid")).toBe("c1");
    const call = m.calls.find((c) => c.url.pathname.endsWith("/chat"))!;
    expect(call.url.searchParams.get("key")).toBe("pk_test");
    const body = JSON.parse(call.init!.body as string);
    expect(body.message).toBe("hi there");
    expect(body.sid).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(body.cid).toBeNull();
  });

  it("shift+enter does not send", async () => {
    const m = mockFetch({});
    vi.stubGlobal("fetch", m.fn);
    mount();
    await openPanel();
    const ta = screen.getByPlaceholderText("Type a message");
    fireEvent.input(ta, { target: { value: "x" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(m.calls.filter((c) => c.url.pathname.endsWith("/chat")).length).toBe(0);
  });

  it("shows fallback text and the lead form on a fallback event, then thanks after submit", async () => {
    const m = mockFetch({ chat: [{ type: "fallback", cid: "c2", text: "server text" }] });
    vi.stubGlobal("fetch", m.fn);
    mount();
    await openPanel();
    await send("question");
    await screen.findByText(config.strings.fallback);
    fireEvent.input(screen.getByLabelText("Your email"), { target: { value: "a@b.co" } });
    fireEvent.input(screen.getByLabelText("Your question"), { target: { value: "help me" } });
    fireEvent.submit(screen.getByLabelText("Your email").closest("form")!);
    await screen.findByText(config.strings.leadThanks);
    const lead = m.calls.find((c) => c.url.pathname.endsWith("/lead"))!;
    expect(lead.url.searchParams.get("key")).toBe("pk_test");
    expect(JSON.parse(lead.init!.body as string)).toMatchObject({ email: "a@b.co", message: "help me", cid: "c2" });
  });

  it("treats a stream with no terminal event as a fallback", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: [{ type: "start", cid: "c3" }, { type: "delta", text: "par" }] }).fn);
    mount();
    await openPanel();
    await send("q");
    await screen.findByText(config.strings.fallback);
    expect(screen.queryByText("par")).toBeNull();
  });

  it("treats 429 and network failures as a fallback", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: () => new Response("{}", { status: 429 }) }).fn);
    mount();
    await openPanel();
    await send("q");
    await screen.findByText(config.strings.fallback);
    cleanup();
    sessionStorage.clear();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    mount();
    await openPanel();
    await send("q");
    await screen.findByText(config.strings.fallback);
  });

  it("restores the stored conversation on open", async () => {
    sessionStorage.setItem("concierge.sid", "sid-aaaaaaaa");
    sessionStorage.setItem("concierge.cid", "c-old");
    const m = mockFetch({
      conversation: {
        messages: [
          { id: "1", role: "visitor", content: "earlier question", images: [], kind: "chat" },
          { id: "2", role: "bot", content: "earlier answer", images: [], kind: "chat" },
        ],
      },
    });
    vi.stubGlobal("fetch", m.fn);
    mount();
    await openPanel();
    await screen.findByText("earlier answer");
    expect(screen.getByText("earlier question")).toBeTruthy();
    const req = m.calls.find((c) => c.url.pathname.endsWith("/conversation"))!;
    expect(req.url.searchParams.get("sid")).toBe("sid-aaaaaaaa");
    expect(req.url.searchParams.get("cid")).toBe("c-old");
    expect(req.url.searchParams.get("key")).toBe("pk_test");
  });

  it("opens straight to the form in fallback mode and sends no chat request", async () => {
    const m = mockFetch({});
    vi.stubGlobal("fetch", m.fn);
    mount({ ...config, mode: "fallback" });
    await openPanel();
    expect(screen.getByLabelText("Your email")).toBeTruthy();
    expect(screen.getByText(config.strings.fallback)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Type a message")).toBeNull();
    expect(m.calls.filter((c) => c.url.pathname.endsWith("/chat")).length).toBe(0);
  });

  it("shows the powered-by link only when showBadge", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount();
    await openPanel();
    expect(screen.getByText("Powered by Concierge")).toBeTruthy();
    cleanup();
    mount({ ...config, showBadge: false });
    await openPanel();
    expect(screen.queryByText("Powered by Concierge")).toBeNull();
  });

  it("exposes open/close to the host API", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    let api!: { open(): void; close(): void };
    mount(config, (a) => (api = a));
    await waitFor(() => expect(api).toBeTruthy());
    act(() => api.open());
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => api.close());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("locks host scroll in the full-screen layout and restores it", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("479"), media: q, addEventListener() {}, removeEventListener() {} }));
    document.documentElement.style.overflow = "scroll";
    mount();
    await openPanel();
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByPlaceholderText("Type a message"), { key: "Escape" });
    expect(document.documentElement.style.overflow).toBe("scroll");
  });
});
