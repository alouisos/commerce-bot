import { describe, expect, it } from "vitest";
import { createMarkerFilter, extractImageMarkers } from "@/lib/chat/images";

describe("extractImageMarkers", () => {
  it("removes markers, keeps allowed ids, collapses blank lines", () => {
    expect(extractImageMarkers("Hi\n[[image:a]]\nBye [[image:zzz]]", new Set(["a"]))).toEqual({
      text: "Hi\n\nBye",
      imageIds: ["a"],
    });
  });

  it("dedupes and keeps order", () => {
    expect(extractImageMarkers("[[image:b]]\nx\n[[image:a]]\n\n\n[[image: b ]]\ny", new Set(["a", "b"]))).toEqual({
      text: "x\n\ny",
      imageIds: ["b", "a"],
    });
  });

  it("leaves text without markers alone", () => {
    expect(extractImageMarkers("See [the page](https://x.y) [ok]", new Set())).toEqual({
      text: "See [the page](https://x.y) [ok]",
      imageIds: [],
    });
  });
});

function run(chunks: string[]): string[] {
  const f = createMarkerFilter();
  const out = chunks.map((c) => f.push(c));
  out.push(f.flush());
  return out;
}

describe("createMarkerFilter", () => {
  it("passes normal text straight through", () => {
    expect(run(["Hello ", "there, see [the page](https://x.y)."])).toEqual(["Hello ", "there, see [the page](https://x.y).", ""]);
  });

  it("drops a marker split across chunks", () => {
    const out = run(["Look:\n[", "[ima", "ge:abc-1", "2]", "]\nNice"]);
    expect(out.join("")).toBe("Look:\n\nNice");
    expect(out[0]).toBe("Look:\n");
    expect(out.slice(1, 4)).toEqual(["", "", ""]);
  });

  it("drops a marker within one chunk", () => {
    expect(run(["a [[image:x]] b"]).join("")).toBe("a  b");
  });

  it("releases an unclosed [[ after 60 chars", () => {
    const f = createMarkerFilter();
    expect(f.push("x [[image:")).toBe("x ");
    const long = "a".repeat(60);
    const released = f.push(long);
    expect(released).toBe("[[image:" + long);
    expect(f.push(" tail")).toBe(" tail");
    expect(f.flush()).toBe("");
  });

  it("releases an unclosed [[ on flush", () => {
    const f = createMarkerFilter();
    expect(f.push("end [[image:ab")).toBe("end ");
    expect(f.flush()).toBe("[[image:ab");
  });

  it("releases [[ that cannot be an image marker", () => {
    const f = createMarkerFilter();
    expect(f.push("a [")).toBe("a ");
    expect(f.push("[note]] b")).toBe("[[note]] b");
  });
});
