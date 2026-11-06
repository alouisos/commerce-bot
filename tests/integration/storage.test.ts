import { describe, expect, it } from "vitest";
import { getStorage } from "@/lib/storage";

describe("local storage", () => {
  it("round-trips put/get/delete", async () => {
    const s = getStorage();
    const key = `sites/x/greeting/${crypto.randomUUID()}.png`;
    await s.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const got = await s.get(key);
    expect(got?.contentType).toBe("image/png");
    expect(Array.from(got!.body)).toEqual([1, 2, 3]);
    await s.delete(key);
    expect(await s.get(key)).toBeNull();
    await s.delete(key);
  });
  it("returns null for missing keys and rejects traversal", async () => {
    const s = getStorage();
    expect(await s.get("sites/none/missing.png")).toBeNull();
    await expect(s.put("../escape", new Uint8Array([1]), "x/y")).rejects.toThrow();
  });
});
