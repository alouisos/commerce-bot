import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@/shared/markdown";

describe("parseMarkdown", () => {
  it("parses bold inside a paragraph", () => {
    expect(parseMarkdown("**Hi** there")).toEqual([
      { t: "p", c: [{ t: "strong", c: [{ t: "text", v: "Hi" }] }, { t: "text", v: " there" }] },
    ]);
  });

  it("parses bullet and numbered lists", () => {
    expect(parseMarkdown("- a\n- b")).toEqual([
      { t: "ul", items: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]] },
    ]);
    expect(parseMarkdown("1. a\n2. b")).toEqual([
      { t: "ol", items: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]] },
    ]);
  });

  it("parses http(s) links", () => {
    expect(parseMarkdown("[shop](https://x.gr/p)")).toEqual([
      { t: "p", c: [{ t: "link", href: "https://x.gr/p", v: "shop" }] },
    ]);
  });

  it("drops unsafe link targets, keeping the label", () => {
    expect(parseMarkdown("[x](javascript:alert(1))")).toEqual([{ t: "p", c: [{ t: "text", v: "x" }] }]);
  });

  it("keeps markup as inert text", () => {
    expect(parseMarkdown("<img src=x onerror=1>")).toEqual([
      { t: "p", c: [{ t: "text", v: "<img src=x onerror=1>" }] },
    ]);
  });

  it("splits paragraphs on blank lines and normalises CRLF", () => {
    expect(parseMarkdown("a\r\n\r\nb")).toEqual([
      { t: "p", c: [{ t: "text", v: "a" }] },
      { t: "p", c: [{ t: "text", v: "b" }] },
    ]);
  });

  it("does not nest bold", () => {
    const [b] = parseMarkdown("**a **b** c**");
    if (b.t !== "p") throw new Error("expected a paragraph");
    for (const n of b.c) if (n.t === "strong") expect(n.c.every((x) => x.t !== "strong")).toBe(true);
  });

  it("returns nothing for blank input", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});
