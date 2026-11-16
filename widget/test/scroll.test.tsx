/** @jsxImportSource preact */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { API, config, mockFetch } from "./fixtures";

// The test DOM has no layout: give the conversation a size by hand.
function size(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reading a reply", () => {
  it("shows the latest-message button only away from the bottom, and it scrolls there", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    render(<App config={config} apiBase={API} siteKey="pk_test" store={sessionStorage} />);
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const scroll = document.querySelector<HTMLElement>(".scroll")!;
    size(scroll, 1000, 300);
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    const button = await screen.findByLabelText(config.strings.scrollToLatest);
    scroll.scrollTo = undefined as unknown as typeof scroll.scrollTo;
    fireEvent.click(button);
    expect(scroll.scrollTop).toBe(1000);
    // At the bottom (within a few lines of it), the button goes away.
    scroll.scrollTop = 640;
    fireEvent.scroll(scroll);
    expect(screen.queryByLabelText(config.strings.scrollToLatest)).toBeNull();
  });

  it("doesn't follow a reply as it streams in", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        chat: [
          { type: "start", cid: "c1" },
          { type: "delta", text: "First line. " },
          { type: "delta", text: "More text further down." },
          { type: "done", messageId: "m1", images: [] },
        ],
      }).fn,
    );
    render(<App config={config} apiBase={API} siteKey="pk_test" store={sessionStorage} />);
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    const scroll = document.querySelector<HTMLElement>(".scroll")!;
    const set = vi.fn();
    let top = 0;
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
        set(v);
      },
    });
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const ta = screen.getByPlaceholderText("Type a message");
    fireEvent.input(ta, { target: { value: "Hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await screen.findByText("More text further down.", { exact: false });
    await screen.findByText(/First line\. More text further down\./);
    // One move, for the visitor's own message; none for the reply as it arrived or finished.
    expect(set).toHaveBeenCalledTimes(1);
    expect(intoView).not.toHaveBeenCalled();
  });
});
