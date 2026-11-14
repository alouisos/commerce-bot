import { beforeEach, describe, expect, it } from "vitest";
import { getSession, hasTeased, markTeased, setConversationId } from "../src/session";

beforeEach(() => sessionStorage.clear());

describe("session", () => {
  it("returns the same valid sid across calls", () => {
    const a = getSession(sessionStorage);
    const b = getSession(sessionStorage);
    expect(a.sid).toBe(b.sid);
    expect(a.sid).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(a.cid).toBeNull();
  });

  it("stores the conversation id", () => {
    setConversationId(sessionStorage, "conv-1");
    expect(getSession(sessionStorage).cid).toBe("conv-1");
    expect(sessionStorage.getItem("concierge.cid")).toBe("conv-1");
  });

  it("still works when storage throws", () => {
    const bad = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
    } as unknown as Storage;
    const a = getSession(bad);
    expect(a.sid).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(getSession(bad).sid).toBe(a.sid);
    setConversationId(bad, "c9");
    expect(getSession(bad).cid).toBe("c9");
    expect(hasTeased(bad)).toBe(false);
    markTeased(bad);
    expect(hasTeased(bad)).toBe(true);
  });

  it("keeps a stable sid and cid when getItem works but setItem throws", () => {
    const bad = { getItem: () => null, setItem() { throw new Error("quota"); } } as unknown as Storage;
    const a = getSession(bad);
    expect(getSession(bad).sid).toBe(a.sid);
    setConversationId(bad, "c-q");
    expect(getSession(bad).cid).toBe("c-q");
  });
});

describe("prompt state", () => {
  it("starts empty and keeps updates for the visit", async () => {
    const { getPromptState, updatePromptState } = await import("../src/session");
    expect(getPromptState(sessionStorage)).toEqual({ shown: 0, lastShownAt: null, silenced: false, requestedPages: [] });
    updatePromptState(sessionStorage, { shown: 1, lastShownAt: 5, requestedPages: ["https://x/p"] });
    updatePromptState(sessionStorage, { silenced: true });
    expect(getPromptState(sessionStorage)).toEqual({ shown: 1, lastShownAt: 5, silenced: true, requestedPages: ["https://x/p"] });
  });

  it("works in memory when storage throws", async () => {
    const { getPromptState, updatePromptState } = await import("../src/session");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    updatePromptState(broken, { silenced: true });
    expect(getPromptState(broken).silenced).toBe(true);
  });
});

describe("reopen after a chat link", () => {
  beforeEach(() => sessionStorage.clear());

  it("is taken once while fresh", async () => {
    const { markReopen, takeReopen } = await import("../src/session");
    markReopen(sessionStorage, 1_000);
    expect(takeReopen(sessionStorage, 1_000 + 30_000)).toBe(true);
    expect(takeReopen(sessionStorage, 1_000 + 30_000)).toBe(false);
  });

  it("expires after two minutes", async () => {
    const { markReopen, takeReopen } = await import("../src/session");
    markReopen(sessionStorage, 1_000);
    expect(takeReopen(sessionStorage, 1_000 + 120_001)).toBe(false);
  });

  it("is false when never set", async () => {
    const { takeReopen } = await import("../src/session");
    expect(takeReopen(sessionStorage, Date.now())).toBe(false);
  });
});
