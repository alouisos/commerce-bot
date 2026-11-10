/** @jsxImportSource preact */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, WidgetConfig } from "../../src/shared/widget-protocol";
import { App } from "../src/ui/App";
import { API, config, mockFetch } from "./fixtures";

const withEmail: WidgetConfig = { ...config, emailCapture: true, language: "el" };
const reply = (cid: string): ChatEvent[] => [
  { type: "start", cid },
  { type: "delta", text: "An answer" },
  { type: "done", messageId: `m-${Math.random()}`, images: [] },
];

function mount(cfg: WidgetConfig = withEmail) {
  return render(<App config={cfg} apiBase={API} siteKey="pk_test" store={sessionStorage} />);
}

async function openPanel() {
  fireEvent.click(screen.getByLabelText("Open chat"));
  return screen.findByRole("dialog");
}

async function chat(text: string, n: number) {
  const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value: text } });
  const button = screen.getByLabelText("Send") as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.getAllByText("An answer")).toHaveLength(n));

}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("consent card", () => {
  it("appears only after the 2nd bot reply, without taking focus", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c1") }).fn);
    mount();
    await openPanel();
    await chat("first", 1);
    expect(screen.queryByText(withEmail.strings.consentAsk)).toBeNull();
    await chat("second", 2);
    await screen.findByText(withEmail.strings.consentAsk);
    expect(screen.getByText(withEmail.strings.consentFine)).toBeTruthy();
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("is not shown when the site can't send email", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c1") }).fn);
    mount({ ...withEmail, emailCapture: false });
    await openPanel();
    await chat("first", 1);
    await chat("second", 2);
    expect(screen.queryByText(withEmail.strings.consentAsk)).toBeNull();
  });

  it("is not shown in fallback mode", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: [{ type: "fallback", cid: "c2", text: "x" }] }).fn);
    mount();
    await openPanel();
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "q" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await screen.findByText(withEmail.strings.fallback);
    expect(screen.queryByText(withEmail.strings.consentAsk)).toBeNull();
  });

  it("Yes sends the email and the widget's language, then thanks", async () => {
    const m = mockFetch({ chat: reply("c1") });
    vi.stubGlobal("fetch", m.fn);
    mount();
    await openPanel();
    await chat("first", 1);
    await chat("second", 2);
    const input = await screen.findByLabelText(withEmail.strings.emailLabel);
    fireEvent.input(input, { target: { value: "maria@example.com" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText(withEmail.strings.consentThanks);
    const call = m.calls.find((c) => c.url.pathname.endsWith("/subscribe"))!;
    expect(call.url.searchParams.get("key")).toBe("pk_test");
    expect(JSON.parse(call.init!.body as string)).toMatchObject({
      key: "pk_test",
      email: "maria@example.com",
      language: "el",
      cid: "c1",
    });
    expect(JSON.parse(call.init!.body as string)).not.toHaveProperty("consentText");
  });

  it("No hides it, and it isn't asked again this visit", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c1") }).fn);
    mount();
    await openPanel();
    await chat("first", 1);
    await chat("second", 2);
    fireEvent.click(await screen.findByText(withEmail.strings.consentNo));
    expect(screen.queryByText(withEmail.strings.consentAsk)).toBeNull();
    cleanup();
    vi.stubGlobal("fetch", mockFetch({ chat: reply("c1") }).fn);
    mount();
    await openPanel();
    await chat("third", 1);
    await chat("fourth", 2);
    expect(screen.queryByText(withEmail.strings.consentAsk)).toBeNull();
  });
});
