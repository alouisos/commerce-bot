import { describe, expect, it } from "vitest";
import { PRESETS, promptBlockReason, type GateState } from "@/shared/prompt-rules";

const now = 1_000_000;
const base: GateState = {
  proactivity: "gentle",
  aiAvailable: true,
  silenced: false,
  busy: false,
  pageKind: "product",
  shownThisVisit: 0,
  requestedOnPage: false,
  pageStartedAt: now - 20_000,
  lastShownAt: null,
  lastScrollAt: now - 5_000,
  intent: "exploring",
  confidence: 0.8,
  pausedKinds: [],
};
const r = (o: Partial<GateState>) => promptBlockReason({ ...base, ...o }, now);

describe("promptBlockReason", () => {
  it("allows a calm, confident visitor", () => {
    expect(r({})).toBeNull();
    expect(r({ lastScrollAt: null })).toBeNull();
  });

  it("presets match the spec defaults", () => {
    expect(PRESETS.off).toBeNull();
    expect(PRESETS.gentle).toEqual({ pageDelayMs: 15000, quietScrollMs: 2000, maxPerVisit: 2, minConfidence: 0.7, minGapMs: 60000 });
    expect(PRESETS.active).toEqual({ pageDelayMs: 8000, quietScrollMs: 1500, maxPerVisit: 3, minConfidence: 0.55, minGapMs: 30000 });
  });

  it("each rule blocks on its own", () => {
    expect(r({ proactivity: "off" })).toBe("off");
    expect(r({ aiAvailable: false })).toBe("ai-unavailable");
    expect(r({ silenced: true })).toBe("silenced");
    expect(r({ busy: true })).toBe("busy");
    expect(r({ pageKind: "checkout" })).toBe("checkout");
    expect(r({ shownThisVisit: 2, lastShownAt: now - 120_000 })).toBe("cap");
    expect(r({ shownThisVisit: 2, lastShownAt: now - 120_000, proactivity: "active" })).toBeNull();
    expect(r({ requestedOnPage: true })).toBe("page-done");
    expect(r({ pageStartedAt: now - 10_000 })).toBe("too-soon");
    expect(r({ pageStartedAt: now - 10_000, proactivity: "active" })).toBeNull();
    expect(r({ shownThisVisit: 1, lastShownAt: now - 30_000 })).toBe("gap");
    expect(r({ lastScrollAt: now - 1_000 })).toBe("scrolling");
    expect(r({ intent: null })).toBe("no-intent");
    expect(r({ confidence: 0.6 })).toBe("low-confidence");
    expect(r({ confidence: 0.6, proactivity: "active" })).toBeNull();
    expect(r({ pausedKinds: ["question"] })).toBe("paused");
    expect(r({ pausedKinds: ["pairing"] })).toBeNull();
  });

  it("reports the first failing rule", () => {
    expect(r({ proactivity: "off", silenced: true })).toBe("off");
    expect(r({ silenced: true, busy: true, pageKind: "checkout" })).toBe("silenced");
  });
});
