import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "@/lib/crawl/ssrf";
import { allowedPort, createSafeLookup } from "@/lib/net/safe-connect";

describe("more internal ranges are blocked", () => {
  it.each(["198.18.0.1", "198.19.255.254", "192.0.0.8", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1"])("%s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(["198.20.0.1", "192.0.1.1", "93.184.216.34"])("but not %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

function lookupWith(answers: { address: string; family: number }[]) {
  const lookup = createSafeLookup(async () => answers);
  return (opts: { all?: boolean } = {}) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) =>
      lookup("shop.example", opts, (err: Error | null, address?: unknown, family?: number) =>
        resolve({ err, result: opts.all ? address : { address, family } }),
      ),
    );
}

describe("the connect-time lookup (pins the checked address, so DNS rebinding can't swap it)", () => {
  it("returns a public address", async () => {
    const { err, result } = await lookupWith([{ address: "93.184.216.34", family: 4 }])();
    expect(err).toBeNull();
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("refuses when any answer is private, loopback or metadata", async () => {
    for (const bad of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fd00:ec2::254"]) {
      const { err } = await lookupWith([
        { address: "93.184.216.34", family: 4 },
        { address: bad, family: bad.includes(":") ? 6 : 4 },
      ])();
      expect(err?.message).toMatch(/not allowed/);
    }
  });

  it("answers in the all-addresses form when asked", async () => {
    const { err, result } = await lookupWith([{ address: "93.184.216.34", family: 4 }])({ all: true });
    expect(err).toBeNull();
    expect(result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("ports", () => {
  it("allows only 80 and 443", () => {
    expect(allowedPort(new URL("https://shop.example/"))).toBe(true);
    expect(allowedPort(new URL("http://shop.example:80/"))).toBe(true);
    expect(allowedPort(new URL("https://shop.example:443/x"))).toBe(true);
    expect(allowedPort(new URL("http://shop.example:3000/"))).toBe(false);
    expect(allowedPort(new URL("https://shop.example:8443/"))).toBe(false);
  });
});
