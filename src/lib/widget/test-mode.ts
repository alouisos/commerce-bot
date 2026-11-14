// The shop owner's test mode for the widget: a per-site key, shown only in the admin, that turns one
// browser tab into a test tab (see the install page). The widget trusts only the server's answer.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** The site's test key: HMAC-SHA256 of its public key under the app secret, base64url, 32 characters. */
export function testModeKey(publicKey: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`test-mode:${publicKey}`).digest("base64url").slice(0, 32);
}

/** True only for this site's own test key (compared in constant time). Anything else means normal mode. */
export function isValidTestKey(publicKey: string, key: string | null | undefined): boolean {
  if (typeof key !== "string" || key.length === 0) return false;
  const expected = Buffer.from(testModeKey(publicKey));
  const given = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
