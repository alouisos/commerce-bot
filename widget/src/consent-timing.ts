import type { Intent } from "../../src/shared/widget-protocol";

/** Bot replies to show before offering the email follow-up: sooner when the visitor is about to buy. */
export function consentReplies(intent: Intent | null): number {
  return intent === "buying" ? 2 : 3;
}
