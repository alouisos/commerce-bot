import { describe, expect, it } from "vitest";
import { buildSnippet } from "@/lib/snippet";
import { relativeTime } from "@/lib/format";

describe("buildSnippet", () => {
  it("builds the exact script tag", () => {
    expect(buildSnippet("https://app.concierge.test", "pk_abc")).toBe(
      '<script src="https://app.concierge.test/widget.js" data-site="pk_abc" async></script>',
    );
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  it("says just now under a minute", () => {
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(59), now)).toBe("just now");
    expect(relativeTime(new Date(now.getTime() + 5000), now)).toBe("just now");
  });
  it("formats minutes, hours and days", () => {
    expect(relativeTime(ago(60), now)).toBe("1 minute ago");
    expect(relativeTime(ago(3 * 60 + 10), now)).toBe("3 minutes ago");
    expect(relativeTime(ago(2 * 3600), now)).toBe("2 hours ago");
    expect(relativeTime(ago(86400 * 3), now)).toBe("3 days ago");
  });
});
