import { describe, expect, it } from "vitest";
import { kindForIntent, scoreIntent, type IntentSignals } from "@/shared/intent";

const base: IntentSignals = {
  pageKind: "other",
  seconds: 0,
  maxScroll: 0,
  fastScroll: false,
  productPages: 0,
  revisitedProduct: false,
  addedToCart: false,
  cartSeen: false,
};
const s = (o: Partial<IntentSignals>) => scoreIntent({ ...base, ...o });

describe("scoreIntent", () => {
  it("a quick look at a product is low-confidence exploring", () => {
    expect(s({ pageKind: "product", seconds: 5, maxScroll: 0.1, productPages: 1 })).toEqual({
      intent: "exploring",
      confidence: 0.5,
    });
  });

  it("time and scrolling on a product raise exploring", () => {
    expect(s({ pageKind: "product", seconds: 20, maxScroll: 0.6, productPages: 1 })).toEqual({
      intent: "exploring",
      confidence: 0.7,
    });
  });

  it("cart and checkout are buying", () => {
    expect(s({ pageKind: "cart" })).toEqual({ intent: "buying", confidence: 0.9 });
    expect(s({ pageKind: "checkout" })).toEqual({ intent: "buying", confidence: 0.95 });
  });

  it("reading a content page slowly is learning; skimming lowers it", () => {
    expect(s({ pageKind: "content", seconds: 40, maxScroll: 0.5 })).toEqual({ intent: "learning", confidence: 0.8 });
    expect(s({ pageKind: "content", seconds: 40, maxScroll: 0.5, fastScroll: true })).toEqual({
      intent: "learning",
      confidence: 0.6,
    });
  });

  it("close scores are ambiguous and lose confidence", () => {
    expect(
      s({ pageKind: "product", seconds: 20, maxScroll: 0.6, productPages: 2, addedToCart: true }),
    ).toEqual({ intent: "buying", confidence: 0.7 });
  });

  it("a revisited product with time on it leans to buying", () => {
    expect(s({ pageKind: "product", seconds: 25, maxScroll: 0.2, productPages: 1, revisitedProduct: true })).toEqual({
      intent: "buying",
      confidence: 0.75,
    });
  });

  it("listing pages are exploring once products were viewed", () => {
    expect(s({ pageKind: "listing", productPages: 2 })).toEqual({ intent: "exploring", confidence: 0.6 });
    expect(s({ pageKind: "listing" })).toEqual({ intent: "exploring", confidence: 0.4 });
  });

  it("nothing to go on means no intent", () => {
    expect(s({ pageKind: "home", seconds: 60 }).intent).toBeNull();
    expect(s({}).intent).toBeNull();
  });

  it("buying intent suggests pairings, the others questions", () => {
    expect(kindForIntent("buying")).toBe("pairing");
    expect(kindForIntent("exploring")).toBe("question");
    expect(kindForIntent("learning")).toBe("question");
  });
});
