import { describe, expect, it } from "vitest";
import { growSheet, previewText, shrinkSheet } from "../src/ui/sheet";

describe("sheet helpers", () => {
  it("grows and shrinks one height at a time, stopping at the ends", () => {
    expect(growSheet("mini")).toBe("peek");
    expect(growSheet("peek")).toBe("full");
    expect(growSheet("full")).toBe("full");
    expect(shrinkSheet("full")).toBe("peek");
    expect(shrinkSheet("peek")).toBe("mini");
    expect(shrinkSheet("mini")).toBe("mini");
  });

  it("turns a reply into one line of plain text", () => {
    expect(previewText("**Argan oil** suits [dry hair](https://x.test/a).\n\n[[image:abc]]\n- `daily`")).toBe(
      "Argan oil suits dry hair. - daily",
    );
    expect(previewText("")).toBe("");
  });
});
