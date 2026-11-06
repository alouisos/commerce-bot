import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks } from "@/db/schema";
import { replaceChunks } from "@/lib/kb/store";
import { searchKnowledge } from "@/lib/kb/search";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite, makeSource } from "../helpers/factories";

describe("knowledge search", () => {
  beforeEach(resetDb);

  async function setup() {
    const acc = await makeAccount();
    const a = await makeSite(acc.id);
    const b = await makeSite(acc.id);
    const srcA = await makeSource(a.id, { title: "Hair" });
    await replaceChunks({
      sourceId: srcA.id,
      siteId: a.id,
      texts: ["Argan oil protects colour-treated hair", "Argan oil hair routine", "Shipping takes 3 days"],
    });
    const srcB = await makeSource(b.id, { title: "B" });
    await replaceChunks({ sourceId: srcB.id, siteId: b.id, texts: ["Argan oil is great"] });
    return { a, b, srcA, srcB };
  }

  it("finds relevant chunks, collapsed per source, scoped to the site", async () => {
    const { a, srcA, srcB } = await setup();
    const hits = await searchKnowledge(a.id, "argan oil hair");
    expect(hits[0].content).toContain("Argan oil");
    expect(hits[0].score).toBeGreaterThan(0.5);
    expect(hits).toHaveLength(1); // one source -> one hit
    expect(hits.every((h) => h.sourceId === srcA.id && h.sourceId !== srcB.id)).toBe(true);
    expect(hits[0]).toMatchObject({ kind: "text", title: "Hair", caption: null, url: null });
  });
  it("excludes excluded, non-ready sources", async () => {
    const { a } = await setup();
    const ex = await makeSource(a.id, { excluded: true });
    const failed = await makeSource(a.id, { status: "failed" });
    await replaceChunks({ sourceId: ex.id, siteId: a.id, texts: ["argan oil hair argan oil hair"] });
    await replaceChunks({ sourceId: failed.id, siteId: a.id, texts: ["argan oil hair argan oil hair"] });
    const hits = await searchKnowledge(a.id, "argan oil hair");
    expect(hits.map((h) => h.sourceId)).not.toContain(ex.id);
    expect(hits.map((h) => h.sourceId)).not.toContain(failed.id);
  });
  it("limits to k sources", async () => {
    const acc = await makeAccount();
    const s = await makeSite(acc.id);
    for (let i = 0; i < 4; i++) {
      const src = await makeSource(s.id, { title: `S${i}` });
      await replaceChunks({ sourceId: src.id, siteId: s.id, texts: [`argan oil ${i}`] });
    }
    expect(await searchKnowledge(s.id, "argan oil", 2)).toHaveLength(2);
  });
  it("replaceChunks replaces and handles empty", async () => {
    const { a, srcA } = await setup();
    expect(await replaceChunks({ sourceId: srcA.id, siteId: a.id, texts: ["one", "two"] })).toBe(2);
    expect(await db.select().from(kbChunks).where(eq(kbChunks.sourceId, srcA.id))).toHaveLength(2);
    expect(await replaceChunks({ sourceId: srcA.id, siteId: a.id, texts: [] })).toBe(0);
    expect(await db.select().from(kbChunks).where(eq(kbChunks.sourceId, srcA.id))).toHaveLength(0);
  });
});
