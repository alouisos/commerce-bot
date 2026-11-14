import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyTestEnv } from "../test-env";

applyTestEnv();

import { isValidTestKey, testModeKey } from "@/lib/widget/test-mode";

const SITE = "pk_live_site_one";
const OTHER = "pk_live_site_two";

describe("test mode key", () => {
  it("is the site's HMAC under the app secret, base64url, 32 characters", () => {
    const expected = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(`test-mode:${SITE}`)
      .digest("base64url")
      .slice(0, 32);
    expect(testModeKey(SITE)).toBe(expected);
    expect(testModeKey(SITE)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(testModeKey(SITE)).toBe(testModeKey(SITE));
    expect(testModeKey(OTHER)).not.toBe(testModeKey(SITE));
  });

  it("accepts only the key for that exact site", () => {
    expect(isValidTestKey(SITE, testModeKey(SITE))).toBe(true);
    expect(isValidTestKey(OTHER, testModeKey(SITE))).toBe(false);
  });

  it("rejects a tampered, shortened, padded or non-ASCII key", () => {
    const key = testModeKey(SITE);
    const flipped = (key[0] === "A" ? "B" : "A") + key.slice(1);
    expect(isValidTestKey(SITE, flipped)).toBe(false);
    expect(isValidTestKey(SITE, key.slice(0, 31))).toBe(false);
    expect(isValidTestKey(SITE, `${key}x`)).toBe(false);
    expect(isValidTestKey(SITE, `é${key.slice(1)}`)).toBe(false);
  });

  it("rejects a missing key", () => {
    expect(isValidTestKey(SITE, null)).toBe(false);
    expect(isValidTestKey(SITE, undefined)).toBe(false);
    expect(isValidTestKey(SITE, "")).toBe(false);
  });
});
