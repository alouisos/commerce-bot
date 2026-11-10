import { describe, expect, it } from "vitest";
import { applyTestEnv } from "../test-env";

applyTestEnv();

import { filterLinks } from "@/lib/email/writer";

const site = { baseUrl: "https://milianjo.com", allowedOrigins: ["https://milianjo.com", "https://www.milianjo.com"] };

describe("filterLinks", () => {
  it("removes off-site URLs whatever their case", () => {
    const { body } = filterLinks("Go to HTTPS://evil.example/x or Http://evil.example now.", site);
    expect(body).not.toMatch(/evil/i);
  });

  it("removes scheme-less off-site hosts", () => {
    const { body } = filterLinks("Visit www.milianjo-outlet.example or evil.example/deal today.", site);
    expect(body).not.toMatch(/milianjo-outlet|evil\.example/i);
    expect(body).toContain("Visit");
  });

  it("keeps the shop's own hosts, written any way", () => {
    const { body, links } = filterLinks(
      "See [Shampoo](https://milianjo.com/p/1), www.milianjo.com and milianjo.com/shop. Email hello@milianjo.com.",
      site,
    );
    expect(links).toEqual(["https://milianjo.com/p/1"]);
    expect(body).toContain("www.milianjo.com");
    expect(body).toContain("milianjo.com/shop");
    expect(body).toContain("hello@milianjo.com");
  });

  it("an off-site markdown link keeps only its text", () => {
    const { body, links } = filterLinks("[Click](HTTPS://evil.example) here", site);
    expect(body).toBe("Click here");
    expect(links).toEqual([]);
  });

  it("only the website's own host and its www twin count, not every allowed origin", () => {
    const wide = { baseUrl: "https://milianjo.com", allowedOrigins: ["https://milianjo.com", "https://evil.example"] };
    const { links, body } = filterLinks("[x](https://evil.example/a) and [y](https://www.milianjo.com/b)", wide);
    expect(links).toEqual(["https://www.milianjo.com/b"]);
    expect(body).not.toContain("evil");
  });
});
