import { describe, expect, it } from "vitest";
import { decodeBody } from "@/lib/crawl/fetcher";

// "Καλημέρα" in ISO-8859-7
const GREEK_8859_7 = new Uint8Array([0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1]);

describe("decodeBody", () => {
  it("uses the charset from the Content-Type header", () => {
    expect(decodeBody(GREEK_8859_7, "text/html; charset=ISO-8859-7")).toBe("Καλημέρα");
  });
  it("falls back to <meta charset>", () => {
    const head = new TextEncoder().encode('<html><head><meta charset="iso-8859-7"></head><body>');
    const bytes = new Uint8Array([...head, ...GREEK_8859_7]);
    expect(decodeBody(bytes, "text/html")).toContain("Καλημέρα");
  });
  it("falls back to <meta http-equiv> content", () => {
    const head = new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=windows-1253">');
    const bytes = new Uint8Array([...head, ...GREEK_8859_7]);
    expect(decodeBody(bytes, "")).toContain("Καλημέρα");
  });
  it("defaults to UTF-8 and tolerates unknown charsets", () => {
    expect(decodeBody(new TextEncoder().encode("Καλημέρα"), "text/html")).toBe("Καλημέρα");
    expect(decodeBody(new TextEncoder().encode("abc"), "text/html; charset=bogus-9")).toBe("abc");
  });
});
