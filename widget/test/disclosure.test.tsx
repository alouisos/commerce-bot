/** @jsxImportSource preact */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, WidgetConfig } from "../../src/shared/widget-protocol";
import { App } from "../src/ui/App";
import { API, config, mockFetch } from "./fixtures";

const reply: ChatEvent[] = [
  { type: "start", cid: "c1" },
  { type: "delta", text: "An answer" },
  { type: "done", messageId: "m1", images: [] },
];

function mount(cfg: WidgetConfig = config) {
  return render(<App config={cfg} apiBase={API} siteKey="pk_test" store={sessionStorage} />);
}

async function send(text: string) {
  const ta = screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value: text } });
  const button = screen.getByLabelText("Send") as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.getAllByText("An answer")).toHaveLength(1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI note", () => {
  it("is not shown when the chat opens", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount();
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    expect(screen.queryByText(config.strings.disclosure)).toBeNull();
  });

  it("appears under the message box after the first reply", async () => {
    vi.stubGlobal("fetch", mockFetch({ chat: reply }).fn);
    mount();
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    await send("hello");
    const note = await screen.findByText(config.strings.disclosure);
    const composer = screen.getByPlaceholderText("Type a message").closest(".composer")!;
    // The note follows the composer in the panel.
    expect(composer.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.className).toBe("disclosure");
  });

  it("is not shown in fallback mode", async () => {
    vi.stubGlobal("fetch", mockFetch({}).fn);
    mount({ ...config, mode: "fallback" });
    fireEvent.click(screen.getByLabelText("Open chat"));
    await screen.findByRole("dialog");
    expect(screen.queryByText(config.strings.disclosure)).toBeNull();
  });
});
