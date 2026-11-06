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
});
