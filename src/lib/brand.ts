import { env } from "@/lib/env";

export const PRODUCT_NAME = "Concierge";

/** Where invite requests from the sign-up page are sent (sign-up is invite-only). */
export const SIGNUP_EMAIL = "alex@manxmachina.com";

/** Where customers can reach the platform owner, or null when none is configured. */
export function contactEmail(): string | null {
  return env.CONTACT_EMAIL ?? env.PLATFORM_OWNER_EMAILS[0] ?? null;
}
