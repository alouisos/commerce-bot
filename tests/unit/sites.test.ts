import { describe, expect, it } from "vitest";
// sites.ts imports the db client, which needs env at import time (connection is lazy).
import "../apply-test-env";

import { deriveAllowedOrigins, generatePublicKey, isOriginAllowed } from "@/lib/sites";
import { siteSettingsSchema } from "@/lib/site-settings";
import { sniffImageType } from "@/lib/files";
import { greetingImageKey, kbObjectKey } from "@/lib/storage";
import { ValidationError } from "@/lib/errors";

const valid = {
  botName: "Mila",
  accentColor: "#112233",
  corner: "bottom-right",
  defaultLanguage: "en",
  guardrails: "",
  greetings: [{ language: "el", message: "Γεια" }],
  allowedOrigins: ["https://milianjo.com"],
  proactivity: "gentle",
};

describe("sites helpers", () => {
  it("generates public keys", () => {
    expect(generatePublicKey()).toMatch(/^pk_[A-Za-z0-9]{24}$/);
    expect(generatePublicKey()).not.toBe(generatePublicKey());
  });
  it("derives allowed origins", () => {
    expect(deriveAllowedOrigins("https://www.milianjo.com/shop/")).toEqual(["https://www.milianjo.com", "https://milianjo.com"]);
    expect(deriveAllowedOrigins("https://milianjo.com")).toEqual(["https://milianjo.com", "https://www.milianjo.com"]);
    expect(deriveAllowedOrigins("http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(deriveAllowedOrigins("http://127.0.0.1:8080/x")).toEqual(["http://127.0.0.1:8080"]);
    expect(deriveAllowedOrigins("https://shop.example.com:8443")).toEqual(["https://shop.example.com:8443", "https://www.shop.example.com:8443"]);
    expect(() => deriveAllowedOrigins("not a url")).toThrow(ValidationError);
    expect(() => deriveAllowedOrigins("ftp://example.com")).toThrow(ValidationError);
  });
  it("matches origins exactly", () => {
    const site = { allowedOrigins: ["https://milianjo.com"] };
    expect(isOriginAllowed(site, "https://milianjo.com")).toBe(true);
    expect(isOriginAllowed(site, "https://MILIANJO.com")).toBe(true);
    expect(isOriginAllowed(site, "https://milianjo.com/")).toBe(true);
    expect(isOriginAllowed(site, "https://evil.com")).toBe(false);
    expect(isOriginAllowed(site, "https://milianjo.com.evil.com")).toBe(false);
    expect(isOriginAllowed(site, "https://evilmilianjo.com")).toBe(false);
    expect(isOriginAllowed(site, null)).toBe(false);
    expect(isOriginAllowed(site, "garbage")).toBe(false);
  });
});

describe("siteSettingsSchema", () => {
  it("accepts valid input", () => expect(siteSettingsSchema.safeParse(valid).success).toBe(true));
  it("rejects bad values", () => {
    expect(siteSettingsSchema.safeParse({ ...valid, accentColor: "red" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, greetings: [{ language: "el", message: "x".repeat(281) }] }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, botName: "" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, corner: "top" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, defaultLanguage: "eng" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, guardrails: "x".repeat(2001) }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, allowedOrigins: ["https://a.com/path"] }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, allowedOrigins: ["javascript:alert(1)"] }).success).toBe(false);
    expect(
      siteSettingsSchema.safeParse({ ...valid, greetings: [{ language: "el", message: "a" }, { language: "el", message: "b" }] }).success,
    ).toBe(false);
  });
});

describe("files and keys", () => {
  it("sniffs image types", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
  it("builds storage keys", () => {
    expect(greetingImageKey("s1", "png")).toMatch(/^sites\/s1\/greeting\/[0-9a-f-]{36}\.png$/);
    expect(kbObjectKey("s1", "src1", "../my file (1).pdf")).toBe("sites/s1/kb/src1/.._my_file__1_.pdf");
    expect(kbObjectKey("s1", "src1", "a".repeat(300) + ".pdf").split("/").pop()!.length).toBe(100);
  });
});
