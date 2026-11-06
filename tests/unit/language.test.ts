import { describe, expect, it } from "vitest";
import { resolveLanguage } from "@/lib/widget/language";

describe("resolveLanguage", () => {
  it("resolves region tags, case, and defaults", () => {
    expect(resolveLanguage("el-GR", ["el", "en"], "en")).toBe("el");
    expect(resolveLanguage("EL", ["el", "en"], "en")).toBe("el");
    expect(resolveLanguage(null, ["el", "en"], "el")).toBe("el");
    expect(resolveLanguage("fr", ["el", "en"], "en")).toBe("en");
    expect(resolveLanguage("en_US", ["el", "en"], "el")).toBe("en");
  });
});
