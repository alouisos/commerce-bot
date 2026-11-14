/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../src/shared/widget-protocol";
import { markReopen, setConversationId } from "../src/session";
import { App } from "../src/ui/App";
import { API, config, mockFetch } from "./fixtures";

const reply: ChatEvent[] = [
  { type: "start", cid: "c1" },
  { type: "delta", text: "See [the ritual](https://shop.test/ritual) and [elsewhere](https://other.test/x)" },
  { type: "done", messageId: "m1", images: [] },
];

function setWidth(narrow: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: narrow && q.includes("max-width"), addEventListener() {}, removeEventListener() {} }));
}

function mount() {
  return render(<App config={config} apiBase={API} siteKey="pk_test" store={sessionStorage} />);
}

beforeEach(() => {
  sessionStorage.clear();
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://shop.test/products/butter");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("following a link from the chat", () => {
  it("clicking a link to the shop marks the chat to reopen; other links don't", async () => {
    setWidth(false);
    vi.stubGlobal("fetch", mockFetch({ chat: reply }).fn);
    mount();
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "where?" } });
    const send = screen.getByLabelText("Send") as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    const other = await screen.findByText("elsewhere");
    // Stop the test browser from really navigating.
    other.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(other, { button: 0 });
    expect(sessionStorage.getItem("concierge.reopen")).toBeNull();
    const shop = screen.getByText("the ritual");
    // Stop happy-dom from navigating away during the test.
    shop.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(shop, { button: 0 });
    expect(sessionStorage.getItem("concierge.reopen")).not.toBeNull();
  });

  it("on a wide screen the chat reopens on the new page with the same conversation", async () => {
    setWidth(false);
    setConversationId(sessionStorage, "c1");
    markReopen(sessionStorage, Date.now());
    vi.stubGlobal(
      "fetch",
      mockFetch({ conversation: { messages: [{ id: "m1", role: "bot", content: "Earlier answer", images: [], kind: "chat" }] } }).fn,
    );
    mount();
    await screen.findByRole("dialog");
    await screen.findByText("Earlier answer");
    // Used once: a further page load doesn't reopen again.
    expect(sessionStorage.getItem("concierge.reopen")).toBeNull();
  });

  it("on a phone it offers to continue instead of covering the page", async () => {
    setWidth(true);
    setConversationId(sessionStorage, "c1");
    markReopen(sessionStorage, Date.now());
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(await screen.findByText(config.strings.continueChat));
    await screen.findByRole("dialog");
  });
});
