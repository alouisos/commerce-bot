import { describe, expect, it } from "vitest";
import { applyTestEnv } from "../test-env";

applyTestEnv();

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";

const SECRET = "cs_0123456789abcdef0123456789abcdef01234567";

describe("stored credentials", () => {
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET);
  });

  it("encrypts the same text differently each time, and never shows it", () => {
    const a = encryptSecret(SECRET);
    const b = encryptSecret(SECRET);
    expect(a).not.toBe(b);
    expect(a).not.toContain(SECRET);
    expect(a).not.toContain("0123456789abcdef");
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("rejects tampering and unknown versions", () => {
    const enc = encryptSecret(SECRET);
    const parts = enc.split(".");
    const ct = parts[3];
    parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(() => decryptSecret(parts.join("."))).toThrow("Can't read a stored credential");
    expect(() => decryptSecret(`v2.${enc.slice(3)}`)).toThrow("Can't read a stored credential");
    expect(() => decryptSecret("garbage")).toThrow("Can't read a stored credential");
  });
});
