import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources, usageEvents } from "@/db/schema";
import { ingestSource } from "@/lib/kb/ingest";
import { searchKnowledge } from "@/lib/kb/search";
import { addDocument, addImage, addText } from "@/lib/kb/sources";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

async function reload(id: string) {
  const [row] = await db.select().from(kbSources).where(eq(kbSources.id, id));
  return row;
}

describe("ingestSource", () => {
  beforeEach(resetDb);

  it("ingests a markdown/pdf document and makes it searchable", async () => {
    const site = await makeSite((await makeAccount()).id);
    for (const [name, type] of [["sample.pdf", "application/pdf"], ["sample.md", "text/markdown"]] as const) {
      const src = await addDocument(site.id, new File([readFileSync(`tests/fixtures/kb/${name}`)], name, { type }));
      await ingestSource(src.id);
      const done = await reload(src.id);
      expect(done).toMatchObject({ status: "ready", error: null });
      const chunks = await db.select().from(kbChunks).where(eq(kbChunks.sourceId, src.id));
      expect(chunks.length).toBeGreaterThan(0);
    }
    const hits = await searchKnowledge(site.id, "Argan oil protects");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain("Argan oil protects");
  });

  it("ingests pasted text", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addText(site.id, { title: "FAQ", text: "Shipping takes three days." });
    await ingestSource(src.id);
    expect((await reload(src.id)).status).toBe("ready");
    expect(await db.select().from(kbChunks).where(eq(kbChunks.sourceId, src.id))).toHaveLength(1);
  });

  it("ingests an image: keeps the admin caption, one chunk, one usage event", async () => {
    const acc = await makeAccount();
    const site = await makeSite(acc.id);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const src = await addImage(site.id, new File([png], "label.png", { type: "image/png" }), "Leave-in label");
    await ingestSource(src.id);
    const done = await reload(src.id);
    expect(done).toMatchObject({ status: "ready", caption: "Leave-in label" });
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.sourceId, src.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content.startsWith("[Image: Leave-in label]")).toBe(true);
    const events = await db.select().from(usageEvents).where(eq(usageEvents.accountId, acc.id));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("image_description");
  });

  it("uses the generated caption when none was given", async () => {
    const site = await makeSite((await makeAccount()).id);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    const src = await addImage(site.id, new File([png], "x.png", { type: "image/png" }));
    await ingestSource(src.id);
    expect((await reload(src.id)).caption).toBe("Test image");
  });

  it("fails a whitespace-only document with a readable error", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addDocument(site.id, new File(["   \n\n  "], "empty.txt", { type: "text/plain" }));
    await ingestSource(src.id);
    expect(await reload(src.id)).toMatchObject({ status: "failed", error: "No readable text found in this file" });
  });

  it("stores a generic message for unexpected errors", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addDocument(site.id, new File([readFileSync("tests/fixtures/kb/sample.md")], "a.md", { type: "text/markdown" }));
    await db.update(kbSources).set({ mimeType: "application/pdf" }).where(eq(kbSources.id, src.id));
    await ingestSource(src.id);
    const done = await reload(src.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("Processing failed. Please try again or upload a different file.");
  });
});
