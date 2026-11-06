import { describe, expect, it } from "vitest";
import { parseRobots, sitemapsFromRobots } from "@/lib/crawl/robots";

describe("parseRobots", () => {
  it("longest match wins between Allow and Disallow", () => {
    const allowed = parseRobots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php");
    expect(allowed("/wp-admin/")).toBe(false);
    expect(allowed("/wp-admin/admin-ajax.php")).toBe(true);
    expect(allowed("/product/argan")).toBe(true);
  });
  it("empty Disallow allows everything", () => {
    expect(parseRobots("User-agent: *\nDisallow:")("/anything")).toBe(true);
  });
  it("ignores other user agents and uses only the * group", () => {
    const allowed = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private");
    expect(allowed("/shop")).toBe(true);
    expect(allowed("/private/x")).toBe(false);
  });
  it("supports wildcards, $ anchors, comments and merged groups", () => {
    const allowed = parseRobots("User-agent: a\nUser-agent: *\nDisallow: /*.json$ # no json\nDisallow: /cart");
    expect(allowed("/data.json")).toBe(false);
    expect(allowed("/data.json5")).toBe(true);
    expect(allowed("/cart")).toBe(false);
  });
  it("allows all when there is no * group", () => {
    expect(parseRobots("User-agent: Bad\nDisallow: /")("/x")).toBe(true);
    expect(parseRobots("")("/x")).toBe(true);
  });
});

describe("sitemapsFromRobots", () => {
  it("collects Sitemap lines", () => {
    expect(sitemapsFromRobots("Sitemap: https://a.test/s.xml\nUser-agent: *\nsitemap: https://a.test/t.xml")).toEqual([
      "https://a.test/s.xml",
      "https://a.test/t.xml",
    ]);
  });
});

describe("parseRobots ConciergeBot group", () => {
  it("prefers a conciergebot group over *", () => {
    const allowed = parseRobots("User-agent: *\nAllow: /\n\nUser-agent: ConciergeBot\nDisallow: /");
    expect(allowed("/shop")).toBe(false);
  });
  it("matches case-insensitively and in merged groups", () => {
    const allowed = parseRobots("User-agent: *\nDisallow: /a\n\nUser-agent: Googlebot\nUser-agent: conciergebot\nDisallow: /b");
    expect(allowed("/b")).toBe(false);
    expect(allowed("/a")).toBe(true);
  });
  it("falls back to * when no conciergebot group exists", () => {
    const allowed = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private");
    expect(allowed("/shop")).toBe(true);
    expect(allowed("/private")).toBe(false);
  });
});
