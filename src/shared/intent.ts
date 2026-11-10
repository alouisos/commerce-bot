// Intent from behaviour within one visit. Pure and shared: the widget scores, the server only stores.
// Types and constants only from other modules; never import anything server-side here.
import type { Intent, PageKind, PromptKind } from "./widget-protocol";

export type IntentSignals = {
  pageKind: PageKind;
  /** Seconds the current page has been visible. */
  seconds: number;
  /** Deepest scroll on the current page, 0–1. */
  maxScroll: number;
  /** Skimming: fast scrolling over the last few seconds. */
  fastScroll: boolean;
  /** Distinct product pages viewed this visit. */
  productPages: number;
  /** The current product was already viewed earlier this visit. */
  revisitedProduct: boolean;
  addedToCart: boolean;
  cartSeen: boolean;
};

export const INTENT_LABELS: Record<Intent, string> = {
  learning: "Learning",
  exploring: "Exploring products",
  buying: "Ready to buy",
};

const SKIM_PENALTY = 0.15;
const AMBIGUOUS_GAP = 0.1;
const AMBIGUOUS_PENALTY = 0.15;
const MIN_SCORE = 0.3;

const bonus = (on: boolean, v: number) => (on ? v : 0);
const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

function buyingScore(s: IntentSignals): number {
  if (s.pageKind === "checkout") return 0.95;
  if (s.pageKind === "cart") return 0.9;
  if (s.addedToCart) return 0.85;
  if (s.pageKind === "product" && s.revisitedProduct && s.seconds >= 20) return 0.75;
  if (s.cartSeen) return 0.6;
  return 0;
}

function exploringScore(s: IntentSignals): number {
  if (s.pageKind === "product") {
    return Math.min(
      0.8,
      0.5 + bonus(s.seconds >= 15, 0.1) + bonus(s.maxScroll >= 0.5, 0.1) + bonus(s.productPages >= 2, 0.1),
    );
  }
  if (s.pageKind === "listing") return s.productPages >= 2 ? 0.6 : 0.4;
  return 0;
}

function learningScore(s: IntentSignals): number {
  if (s.pageKind !== "content") return 0;
  return Math.min(
    0.8,
    0.45 + bonus(s.seconds >= 30, 0.15) + bonus(s.maxScroll >= 0.4, 0.15) + bonus(!s.fastScroll, 0.05),
  );
}

/** The most likely intent and how sure we are. Low or ambiguous evidence gives low confidence. */
export function scoreIntent(s: IntentSignals): { intent: Intent | null; confidence: number } {
  const penalty = s.fastScroll ? SKIM_PENALTY : 0;
  const scores = (
    [
      ["buying", buyingScore(s)],
      ["exploring", exploringScore(s)],
      ["learning", learningScore(s)],
    ] as [Intent, number][]
  )
    .map(([i, v]) => [i, round(Math.max(0, v - penalty))] as [Intent, number])
    .sort((a, b) => b[1] - a[1]);
  const [[intent, top], [, second]] = scores;
  if (top < MIN_SCORE) return { intent: null, confidence: top };
  const ambiguous = second > 0 && top - second < AMBIGUOUS_GAP;
  return { intent, confidence: round(ambiguous ? top - AMBIGUOUS_PENALTY : top) };
}

export function kindForIntent(intent: Intent): PromptKind {
  return intent === "buying" ? "pairing" : "question";
}
