import { describe, expect, it } from "vitest";
import { isLive } from "@/lib/sites-status";

const now = new Date("2026-11-11T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("isLive", () => {
  it("is false when the widget was never seen", () => {
    expect(isLive(null, now)).toBe(false);
  });
  it("is true when seen within 7 days", () => {
    expect(isLive(daysAgo(6), now)).toBe(true);
  });
  it("is false when last seen more than 7 days ago", () => {
    expect(isLive(daysAgo(8), now)).toBe(false);
  });
});
