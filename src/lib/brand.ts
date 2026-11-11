import { env } from "@/lib/env";

export const PRODUCT_NAME = "Concierge";

/** Where new customers ask for an account (sign-up is invite-only). */
export const SIGNUP_EMAIL = "alex@manxmachina.com";

/** A ready-to-send access request to SIGNUP_EMAIL. */
export const signupMailto = `mailto:${SIGNUP_EMAIL}?subject=${encodeURIComponent("Concierge account")}&body=${encodeURIComponent(
  "Hi Alex,\n\nI'd like a Concierge account for my website: \n\nThanks!",
)}`;

/** Where customers can reach the platform owner, or null when none is configured. */
export function contactEmail(): string | null {
  return env.CONTACT_EMAIL ?? env.PLATFORM_OWNER_EMAILS[0] ?? null;
}
