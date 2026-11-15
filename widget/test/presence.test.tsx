/** @jsxImportSource preact */
import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT_MS, usePresence } from "../src/ui/presence";

function Probe({ value }: { value: string | null }) {
  const { shown, leaving } = usePresence(value);
  return shown ? <p data-leaving={String(leaving)}>{shown}</p> : null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePresence", () => {
  it("keeps the last value for the exit animation, then removes it", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="hi" />);
    expect(screen.getByText("hi").dataset.leaving).toBe("false");
    rerender(<Probe value={null} />);
    expect(screen.getByText("hi").dataset.leaving).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_MS);
    });
    expect(screen.queryByText("hi")).toBeNull();
  });

  it("shows a value that comes back while leaving at once", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="hi" />);
    rerender(<Probe value={null} />);
    rerender(<Probe value="again" />);
    expect(screen.getByText("again").dataset.leaving).toBe("false");
  });

  it("removes at once with reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
    const { rerender } = render(<Probe value="hi" />);
    rerender(<Probe value={null} />);
    expect(screen.queryByText("hi")).toBeNull();
  });
});
