import { describe, expect, it } from "vitest";
import { PRESETS, promptBlockReason, REQUESTS_PER_VISIT, type GateState } from "@/shared/prompt-rules";

const POST_CHAT_WAIT_MS = PRESETS.gentle!.postChatWaitMs;
const POST_CHAT_MAX = PRESETS.gentle!.postChatMax;

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
    expect(PRESETS.gentle).toEqual({
      pageDelayMs: 4000,
      quietScrollMs: 2000,
      maxPerVisit: 2,
      minConfidence: 0.7,
      minGapMs: 60000,
      postChatWaitMs: 30000,
      postChatMax: 1,
      postChatAnyIntent: false,
    });
    expect(PRESETS.active).toEqual({
      pageDelayMs: 3000,
      quietScrollMs: 1200,
      maxPerVisit: 4,
      minConfidence: 0.5,
      minGapMs: 25000,
      postChatWaitMs: 20000,
      postChatMax: 2,
      postChatAnyIntent: true,
    });
    expect(PRESETS.eager).toEqual({
      pageDelayMs: 2000,
      quietScrollMs: 800,
      maxPerVisit: 8,
      minConfidence: 0.4,
      minGapMs: 15000,
      postChatWaitMs: 12000,
      postChatMax: 3,
      postChatAnyIntent: true,
    });
    expect(PRESETS.test).toMatchObject({ pageDelayMs: 3000, quietScrollMs: 500, maxPerVisit: 1000, minConfidence: 0, minGapMs: 5000 });
  });

  it("each level is at least as proactive as the one below, and the server allows its requests", () => {
    const levels = [PRESETS.gentle!, PRESETS.active!, PRESETS.eager!];
    for (let i = 1; i < levels.length; i++) {
      const [lo, hi] = [levels[i - 1], levels[i]];
      expect(hi.pageDelayMs).toBeLessThanOrEqual(lo.pageDelayMs);
      expect(hi.quietScrollMs).toBeLessThanOrEqual(lo.quietScrollMs);
      expect(hi.maxPerVisit).toBeGreaterThan(lo.maxPerVisit);
      expect(hi.minConfidence).toBeLessThanOrEqual(lo.minConfidence);
      expect(hi.minGapMs).toBeLessThanOrEqual(lo.minGapMs);
      expect(hi.postChatMax).toBeGreaterThanOrEqual(lo.postChatMax);
    }
    for (const level of ["gentle", "active", "eager"] as const) {
      expect(REQUESTS_PER_VISIT[level]).toBeGreaterThanOrEqual(PRESETS[level]!.maxPerVisit + PRESETS[level]!.postChatMax);
    }
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
    expect(r({ pageStartedAt: now - 2_500, proactivity: "active" })).toBe("too-soon");
    expect(r({ pageStartedAt: now - 3_000, proactivity: "active" })).toBeNull();
    expect(r({ pageStartedAt: now - 2_000, proactivity: "eager" })).toBeNull();
    expect(r({ shownThisVisit: 7, lastShownAt: now - 15_000, proactivity: "eager" })).toBeNull();
    expect(r({ shownThisVisit: 8, lastShownAt: now - 60_000, proactivity: "eager" })).toBe("cap");
    expect(r({ confidence: 0.4, proactivity: "eager" })).toBeNull();
    expect(r({ confidence: 0.39, proactivity: "eager" })).toBe("low-confidence");
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

  describe("after the visitor chatted", () => {
    // Chatted on another page, closed the panel a minute ago, now ready to buy.
    const chatted: Partial<GateState> = {
      chatted: true,
      onChatPage: false,
      chatClosedAt: now - 60_000,
      postChatShown: 0,
      intent: "buying",
      confidence: 0.9,
    };
    const c = (o: Partial<GateState>) => r({ ...chatted, ...o });

    it("on Gentle: 30 s after closing, once", () => {
      expect(POST_CHAT_WAIT_MS).toBe(30000);
      expect(POST_CHAT_MAX).toBe(1);
    });

    it("Active and Eager wait less, offer more, and help with any clear intent", () => {
      const a = (o: Partial<GateState>) => c({ proactivity: "active", ...o });
      expect(a({ chatClosedAt: now - 20_000, intent: "exploring", confidence: 0.8 })).toBeNull();
      expect(a({ chatClosedAt: now - 19_999 })).toBe("after-chat-wait");
      expect(a({ postChatShown: 1 })).toBeNull();
      expect(a({ postChatShown: 2 })).toBe("after-chat-cap");
      const e = (o: Partial<GateState>) => c({ proactivity: "eager", ...o });
      expect(e({ chatClosedAt: now - 12_000, intent: "learning", confidence: 0.5 })).toBeNull();
      expect(e({ postChatShown: 3 })).toBe("after-chat-cap");
      // Still never on the page where they chatted.
      expect(e({ onChatPage: true })).toBe("chat-page");
    });

    it("allows one buying suggestion on another page once the panel was closed 30 s ago", () => {
      expect(c({})).toBeNull();
      expect(c({ chatClosedAt: now - POST_CHAT_WAIT_MS })).toBeNull();
    });

    it("never on a page where the visitor chatted", () => {
      expect(c({ onChatPage: true })).toBe("chat-page");
    });

    it("waits until the panel has been closed for 30 s", () => {
      expect(c({ chatClosedAt: null })).toBe("after-chat-wait");
      expect(c({ chatClosedAt: now - POST_CHAT_WAIT_MS + 1 })).toBe("after-chat-wait");
    });

    it("only for a visitor ready to buy", () => {
      expect(c({ intent: "exploring", confidence: 0.8 })).toBe("after-chat-intent");
      expect(c({ intent: "learning", confidence: 0.8 })).toBe("after-chat-intent");
      expect(c({ intent: null })).toBe("no-intent");
    });

    it("at most one, on top of the normal cap and gap", () => {
      expect(c({ postChatShown: POST_CHAT_MAX })).toBe("after-chat-cap");
      expect(c({ shownThisVisit: 2, lastShownAt: now - 1_000 })).toBeNull();
    });

    it("the normal gates still apply", () => {
      expect(c({ proactivity: "off" })).toBe("off");
      expect(c({ silenced: true })).toBe("silenced");
      expect(c({ busy: true })).toBe("busy");
      expect(c({ pageKind: "checkout" })).toBe("checkout");
      expect(c({ requestedOnPage: true })).toBe("page-done");
      expect(c({ pageStartedAt: now - 3_500 })).toBe("too-soon");
      expect(c({ lastScrollAt: now - 1_000 })).toBe("scrolling");
      expect(c({ confidence: 0.6 })).toBe("low-confidence");
      expect(c({ pausedKinds: ["pairing"] })).toBe("paused");
    });

    it("test mode ignores the after-chat limits", () => {
      const t = (o: Partial<GateState>) => c({ testMode: true, ...o });
      expect(t({ onChatPage: true })).toBeNull();
      expect(t({ chatClosedAt: null })).toBeNull();
      expect(t({ intent: "exploring", confidence: 0.8 })).toBeNull();
      expect(t({ postChatShown: 5 })).toBeNull();
    });

    it("a visit without a chat is unchanged", () => {
      expect(r({ chatted: false, onChatPage: true, chatClosedAt: null, postChatShown: 3 })).toBeNull();
      expect(r({ chatted: false, shownThisVisit: 2, lastShownAt: now - 120_000 })).toBe("cap");
      expect(r({ chatted: false, shownThisVisit: 1, lastShownAt: now - 30_000 })).toBe("gap");
    });
  });
});
