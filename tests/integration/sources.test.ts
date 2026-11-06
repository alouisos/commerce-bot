import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { enqueuedJobs } from "@/lib/jobs";
import { addDocument, addImage, addText, deleteSource, setExcluded } from "@/lib/kb/sources";
import { getStorage } from "@/lib/storage";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite, makeSource } from "../helpers/factories";

const fixture = (n: string) => readFileSync(`tests/fixtures/kb/${n}`);
const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("knowledge sources", () => {
  beforeEach(resetDb);

  it("addDocument creates a pending source, stores the object and enqueues ingestion", async () => {
    const acc = await makeAccount();
    const site = await makeSite(acc.id);
    const buf = fixture("sample.pdf");
    const src = await addDocument(site.id, new File([buf], "sample.pdf", { type: "application/pdf" }));
    expect(src).toMatchObject({ kind: "document", status: "pending", bytes: buf.length, mimeType: "application/pdf" });
    expect(src.storageKey).toContain(`sites/${site.id}/kb/${src.id}/`);
    expect((await getStorage().get(src.storageKey!))?.body.length).toBe(buf.length);
    expect(enqueuedJobs()).toContainEqual({ name: "ingest-source", data: { sourceId: src.id }, options: {} });
  });

  it("accepts .md with an empty browser type, normalised to text/markdown", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addDocument(site.id, new File(["# hi"], "notes.md", { type: "" }));
    expect(src.mimeType).toBe("text/markdown");
  });

  it("rejects bad documents", async () => {
    const site = await makeSite((await makeAccount()).id);
    await expect(addDocument(site.id, new File(["x"], "a.exe", { type: "application/x-msdownload" }))).rejects.toThrow(ValidationError);
    await expect(addDocument(site.id, new File(["not a pdf"], "a.pdf", { type: "application/pdf" }))).rejects.toThrow(ValidationError);
  });

  it("addImage rejects a 6 MB PNG, an SVG, and a PDF", async () => {
    const site = await makeSite((await makeAccount()).id);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(pngHeader);
    await expect(addImage(site.id, new File([big], "big.png", { type: "image/png" }))).rejects.toThrow(ValidationError);
    await expect(addImage(site.id, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).rejects.toThrow(ValidationError);
    const pdf = new Uint8Array(1024 * 1024);
    pdf.set([0x25, 0x50, 0x44, 0x46]);
    await expect(addImage(site.id, new File([pdf], "a.png", { type: "image/png" }))).rejects.toThrow(ValidationError);
    expect(await db.select().from(kbSources)).toHaveLength(0);
  });

  it("addImage rejects a declared type that disagrees with the content", async () => {
    const site = await makeSite((await makeAccount()).id);
    const png = new Uint8Array([...pngHeader, 0, 0]);
    await expect(addImage(site.id, new File([png], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(ValidationError);
    const ok = await addImage(site.id, new File([png], "a.png", { type: "image/png" }), " Label ");
    expect(ok).toMatchObject({ kind: "image", caption: "Label", mimeType: "image/png" });
  });

  it("addText stores the text and counts its bytes", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addText(site.id, { title: "FAQ", text: "Ωmega" });
    expect(src).toMatchObject({ kind: "text", bytes: 6, title: "FAQ" });
    await expect(addText(site.id, { title: "", text: "x" })).rejects.toThrow(ValidationError);
    await expect(addText(site.id, { title: "t", text: "  " })).rejects.toThrow(ValidationError);
  });

  it("throws PlanLimitError when the account is over its storage limit", async () => {
    const acc = await makeAccount({ plan: "starter" });
    const site = await makeSite(acc.id);
    const other = await makeSite(acc.id);
    await makeSource(other.id, { bytes: Math.round(99.9 * 1024 * 1024) });
    const doc = new File([new Uint8Array(200 * 1024).fill(97)], "big.txt", { type: "text/plain" });
    await expect(addDocument(site.id, doc)).rejects.toThrow(PlanLimitError);
    expect(await db.select().from(kbSources).where(eq(kbSources.siteId, site.id))).toHaveLength(0);
  });

  it("scopes delete and exclude by site", async () => {
    const acc = await makeAccount();
    const a = await makeSite(acc.id);
    const b = await makeSite(acc.id);
    const srcB = await makeSource(b.id);
    await expect(deleteSource(a.id, srcB.id)).rejects.toThrow(NotFoundError);
    await expect(setExcluded(a.id, srcB.id, true)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(kbSources).where(eq(kbSources.id, srcB.id))).toHaveLength(1);
    await setExcluded(b.id, srcB.id, true);
    expect((await db.select().from(kbSources).where(eq(kbSources.id, srcB.id)))[0].excluded).toBe(true);
  });

  it("deleteSource removes the stored object", async () => {
    const site = await makeSite((await makeAccount()).id);
    const src = await addText(site.id, { title: "t", text: "hello" });
    await deleteSource(site.id, src.id);
    expect(await getStorage().get(src.storageKey!)).toBeNull();
    expect(await db.select().from(kbSources)).toHaveLength(0);
  });
});
