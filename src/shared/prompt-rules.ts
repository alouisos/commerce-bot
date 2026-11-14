// When the widget may offer a suggestion (spec §5.5). Pure and shared; every unclear case blocks.
import type { Intent, PageKind, Proactivity, PromptKind } from "./widget-protocol";
import { kindForIntent } from "./intent";

export type Preset = {
  /** No suggestion this soon after a page starts. */
  pageDelayMs: number;
  /** No suggestion while the visitor scrolled this recently. */
  quietScrollMs: number;
  maxPerVisit: number;
  minConfidence: number;
  /** Minimum time between two suggestions in one visit. */
  minGapMs: number;
};

export const PRESETS: Record<Proactivity, Preset | null> & { test: Preset } = {
  off: null,
  gentle: { pageDelayMs: 4000, quietScrollMs: 2000, maxPerVisit: 2, minConfidence: 0.7, minGapMs: 60000 },
  active: { pageDelayMs: 4000, quietScrollMs: 1500, maxPerVisit: 3, minConfidence: 0.55, minGapMs: 30000 },
  /** The shop owner's test tab (never a site setting): quick and unlimited, so the bot can be tried out. */
  test: { pageDelayMs: 3000, quietScrollMs: 500, maxPerVisit: 1000, minConfidence: 0, minGapMs: 5000 },
};

/** A shown suggestion hides itself after this long (counts as ignored). */
export const PROMPT_VISIBLE_MS = 20000;

/** A shown suggestion stays up at least this long: scrolling doesn't hide it before then. */
export const PROMPT_MIN_VISIBLE_MS = 10000;

export type GateState = {
  proactivity: Proactivity;
  aiAvailable: boolean;
  /** Dismissed a suggestion or the greeting, or opened the chat, this visit. */
  silenced: boolean;
  /** Panel open, greeting or suggestion showing, or a suggestion request in flight. */
  busy: boolean;
  pageKind: PageKind;
  shownThisVisit: number;
  requestedOnPage: boolean;
  pageStartedAt: number;
  lastShownAt: number | null;
  lastScrollAt: number | null;
  intent: Intent | null;
  confidence: number;
  pausedKinds: PromptKind[];
  /**
   * The owner's test tab, confirmed by the server: the `test` preset, and neither silence nor back-off
   * applies. Suggestions switched off ("off") still means none.
   */
  testMode?: boolean;
};

export type BlockReason =
  | "off"
  | "ai-unavailable"
  | "silenced"
  | "busy"
  | "checkout"
  | "cap"
  | "page-done"
  | "too-soon"
  | "gap"
  | "scrolling"
  | "no-intent"
  | "low-confidence"
  | "paused";

/** Why no suggestion may be requested now, or null when one may. */
export function promptBlockReason(s: GateState, now: number): BlockReason | null {
  if (!PRESETS[s.proactivity]) return "off";
  const test = s.testMode === true;
  const p = test ? PRESETS.test : PRESETS[s.proactivity]!;
  if (!s.aiAvailable) return "ai-unavailable";
  if (s.silenced && !test) return "silenced";
  if (s.busy) return "busy";
  if (s.pageKind === "checkout") return "checkout";
  if (s.shownThisVisit >= p.maxPerVisit) return "cap";
  if (s.requestedOnPage) return "page-done";
  if (now - s.pageStartedAt < p.pageDelayMs) return "too-soon";
  if (s.lastShownAt !== null && now - s.lastShownAt < p.minGapMs) return "gap";
  if (s.lastScrollAt !== null && now - s.lastScrollAt < p.quietScrollMs) return "scrolling";
  if (!s.intent) return "no-intent";
  if (s.confidence < p.minConfidence) return "low-confidence";
  if (!test && s.pausedKinds.includes(kindForIntent(s.intent))) return "paused";
  return null;
}
