import { cosineDistance, asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { kbChunks, kbSources } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

const vec = (i: number) => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));

describe("schema", () => {
  beforeEach(resetDb);

  it("orders chunks by cosine distance", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    const [source] = await db
      .insert(kbSources)
      .values({ siteId: site.id, kind: "text", title: "t", status: "ready" })
      .returning();
    await db.insert(kbChunks).values([
      { sourceId: source.id, siteId: site.id, ordinal: 0, content: "second", embedding: vec(1) },
      { sourceId: source.id, siteId: site.id, ordinal: 1, content: "first", embedding: vec(0) },
    ]);
    const rows = await db
      .select({ content: kbChunks.content })
      .from(kbChunks)
      .orderBy(asc(cosineDistance(kbChunks.embedding, vec(0))));
    expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
  });

  it("rejects a duplicate site publicKey", async () => {
    const account = await makeAccount();
    await makeSite(account.id, { publicKey: "dup" });
    await expect(makeSite(account.id, { publicKey: "dup" })).rejects.toThrow();
  });

  it("enforces unique page urls per site but allows other kinds", async () => {
    const account = await makeAccount();
    const site = await makeSite(account.id);
    const page = { siteId: site.id, kind: "page" as const, title: "p", url: "https://example.com/a" };
    await db.insert(kbSources).values(page);
    await expect(db.insert(kbSources).values(page)).rejects.toThrow();
    await db.insert(kbSources).values([
      { ...page, kind: "text" },
      { ...page, kind: "text" },
    ]);
  });
});
