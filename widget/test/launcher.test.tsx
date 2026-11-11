/** @jsxImportSource preact */
import { render } from "preact";
import { describe, expect, it } from "vitest";
import { Launcher } from "../src/ui/Launcher";

function mount(iconUrl: string | null) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Launcher label="Open chat" expanded={false} onClick={() => {}} buttonRef={{ current: null }} iconUrl={iconUrl} />, root);
  return root;
}

describe("Launcher", () => {
  it("shows the uploaded icon image instead of the default glyph", () => {
    const root = mount("http://app.test/icon.png?v=abc");
    const button = root.querySelector("button")!;
    const img = button.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("http://app.test/icon.png?v=abc");
    expect(img.getAttribute("alt")).toBe("");
    expect(button.querySelector("svg")).toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Open chat");
  });

  it("falls back to the default glyph without an icon", () => {
    const button = mount(null).querySelector("button")!;
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.querySelector("img")).toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Open chat");
  });
});
