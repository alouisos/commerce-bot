import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/lib/ai/describe-image";

describe("buildPrompt", () => {
  it("includes the owner's caption only when given", () => {
    expect(buildPrompt()).not.toContain("shop owner's caption");
    expect(buildPrompt("Leave-in")).toContain(`The shop owner's caption: "Leave-in".`);
    expect(buildPrompt()).toContain("Return a short caption (max 12 words) and the full description.");
  });
});
