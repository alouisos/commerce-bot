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
    expect(PRESETS.gentle).toEqual({ pageDelayMs: 4000, quietScrollMs: 2000, maxPerVisit: 2, minConfidence: 0.7, minGapMs: 60000 });
    expect(PRESETS.active).toEqual({ pageDelayMs: 4000, quietScrollMs: 1500, maxPerVisit: 3, minConfidence: 0.55, minGapMs: 30000 });
    expect(PRESETS.test).toEqual({ pageDelayMs: 3000, quietScrollMs: 500, maxPerVisit: 1000, minConfidence: 0, minGapMs: 5000 });
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
    expect(r({ pageStartedAt: now - 3_500 })).toBe("too-soon");
    expect(r({ pageStartedAt: now - 3_500, proactivity: "active" })).toBe("too-soon");
    expect(r({ pageStartedAt: now - 4_000 })).toBeNull();
    expect(r({ shownThisVisit: 1, lastShownAt: now - 30_000 })).toBe("gap");
    expect(r({ lastScrollAt: now - 1_000 })).toBe("scrolling");
    expect(r({ intent: null })).toBe("no-intent");
    expect(r({ confidence: 0.6 })).toBe("low-confidence");
    expect(r({ confidence: 0.6, proactivity: "active" })).toBeNull();
    expect(r({ pausedKinds: ["question"] })).toBe("paused");
    expect(r({ pausedKinds: ["pairing"] })).toBeNull();
  });

  it("test mode uses the test preset and ignores silence and back-off, but not off", () => {
    const t = (o: Partial<GateState>) => r({ testMode: true, ...o });
    expect(t({ proactivity: "off" })).toBe("off");
    expect(t({ pageStartedAt: now - 2_900 })).toBe("too-soon");
    expect(t({ pageStartedAt: now - 3_000 })).toBeNull();
    expect(t({ lastScrollAt: now - 400 })).toBe("scrolling");
    expect(t({ lastScrollAt: now - 600 })).toBeNull();
    expect(t({ shownThisVisit: 999, lastShownAt: now - 4_000 })).toBe("gap");
    expect(t({ shownThisVisit: 999, lastShownAt: now - 5_000 })).toBeNull();
    expect(t({ shownThisVisit: 1000, lastShownAt: now - 60_000 })).toBe("cap");
    expect(t({ confidence: 0 })).toBeNull();
    expect(t({ silenced: true })).toBeNull();
    expect(t({ pausedKinds: ["question"] })).toBeNull();
    // Still never on checkout, while busy, without AI, twice on one page, or with no intent at all.
    expect(t({ pageKind: "checkout" })).toBe("checkout");
    expect(t({ busy: true })).toBe("busy");
    expect(t({ aiAvailable: false })).toBe("ai-unavailable");
    expect(t({ requestedOnPage: true })).toBe("page-done");
    expect(t({ intent: null })).toBe("no-intent");
    // Without the flag nothing changes.
    expect(r({ testMode: false, silenced: true })).toBe("silenced");
  });

  it("reports the first failing rule", () => {
    expect(r({ proactivity: "off", silenced: true })).toBe("off");
    expect(r({ silenced: true, busy: true, pageKind: "checkout" })).toBe("silenced");
  });
});
