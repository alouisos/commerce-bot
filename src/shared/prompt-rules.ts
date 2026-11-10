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

export const PRESETS: Record<Proactivity, Preset | null> = {
  off: null,
  gentle: { pageDelayMs: 15000, quietScrollMs: 2000, maxPerVisit: 2, minConfidence: 0.7, minGapMs: 60000 },
  active: { pageDelayMs: 8000, quietScrollMs: 1500, maxPerVisit: 3, minConfidence: 0.55, minGapMs: 30000 },
};

/** A shown suggestion hides itself after this long (counts as ignored). */
export const PROMPT_VISIBLE_MS = 20000;

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
  const p = PRESETS[s.proactivity];
  if (!p) return "off";
  if (!s.aiAvailable) return "ai-unavailable";
  if (s.silenced) return "silenced";
  if (s.busy) return "busy";
  if (s.pageKind === "checkout") return "checkout";
  if (s.shownThisVisit >= p.maxPerVisit) return "cap";
  if (s.requestedOnPage) return "page-done";
  if (now - s.pageStartedAt < p.pageDelayMs) return "too-soon";
  if (s.lastShownAt !== null && now - s.lastShownAt < p.minGapMs) return "gap";
  if (s.lastScrollAt !== null && now - s.lastScrollAt < p.quietScrollMs) return "scrolling";
  if (!s.intent) return "no-intent";
  if (s.confidence < p.minConfidence) return "low-confidence";
  if (s.pausedKinds.includes(kindForIntent(s.intent))) return "paused";
  return null;
}
