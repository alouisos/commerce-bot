import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fakeEmbedder } from "@/lib/ai/embed";
import { replaceChunks } from "@/lib/kb/store";
import { searchKnowledge } from "@/lib/kb/search";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite, makeSource } from "../helpers/factories";

class Rollback extends Error {}

describe("knowledge search through the HNSW index", () => {
  beforeEach(resetDb);

  it("a small tenant still gets its chunks when a big tenant's chunks are nearer the query", { timeout: 120_000 }, async () => {
    const acc = await makeAccount();
    const big = await makeSite(acc.id);
    const small = await makeSite(acc.id);
    const bigSrc = await makeSource(big.id, { title: "Big" });
    const smallSrc = await makeSource(small.id, { title: "Small" });
    const query = "argan oil";
    const [qv] = await fakeEmbedder.embed([query], "query");

    // Tenant B: 3 relevant chunks, less similar to the query than A's.
    await replaceChunks({
      sourceId: smallSrc.id,
      siteId: small.id,
      texts: ["Argan oil is great for dry hair", "Our argan oil is cold pressed", "Argan oil ships in glass bottles"],
    });

    let hits: Awaited<ReturnType<typeof searchKnowledge>> = [];
    let plan = "";
    try {
      await db.transaction(async (tx) => {
        // Tenant A: 3,000 chunks right next to the query vector (query + small noise), so the
        // HNSW candidate list (ef_search) is all A's and the site filter removes every one.
        await tx.execute(sql`
          INSERT INTO kb_chunks (source_id, site_id, ordinal, content, embedding)
          SELECT ${bigSrc.id}::uuid, ${big.id}::uuid, g, 'noise ' || g,
            (SELECT array_agg(q.v + (random() - 0.5) * 0.05 + 0 * g ORDER BY q.i)
               FROM unnest(${`{${qv.join(",")}}`}::real[]) WITH ORDINALITY AS q(v, i))::vector
          FROM generate_series(1, 3000) AS g`);
        // Leave the planner no way to answer the ORDER BY except the HNSW index.
        await tx.execute(sql`DROP INDEX kb_chunks_site_idx`);
        await tx.execute(sql`DROP INDEX kb_chunks_source_idx`);
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        await tx.execute(sql`ANALYZE kb_chunks`);
        const explain = await tx.execute<{ "QUERY PLAN": string }>(sql`
          EXPLAIN SELECT c.id FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
          WHERE c.site_id = ${small.id} AND s.site_id = ${small.id} AND s.status = 'ready' AND s.excluded = false
          ORDER BY c.embedding <=> ${`[${qv.join(",")}]`}::vector LIMIT 24`);
        plan = (explain as unknown as { "QUERY PLAN": string }[]).map((r) => r["QUERY PLAN"]).join("\n");
        hits = await searchKnowledge(small.id, query, 6, tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(plan).toContain("kb_chunks_embedding_idx");
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceId).toBe(smallSrc.id);
    expect(hits[0].content).toMatch(/argan oil/i);
  });

  it("a small site is searched exactly, whatever the index scan's limits", { timeout: 120_000 }, async () => {
    const acc = await makeAccount();
    const big = await makeSite(acc.id);
    const small = await makeSite(acc.id);
    const bigSrc = await makeSource(big.id, { title: "Big" });
    const smallSrc = await makeSource(small.id, { title: "Small" });
    const [qv] = await fakeEmbedder.embed(["argan oil"], "query");
    await replaceChunks({ sourceId: smallSrc.id, siteId: small.id, texts: ["Argan oil is great for dry hair"] });

    let hits: Awaited<ReturnType<typeof searchKnowledge>> = [];
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO kb_chunks (source_id, site_id, ordinal, content, embedding)
          SELECT ${bigSrc.id}::uuid, ${big.id}::uuid, g, 'noise ' || g,
            (SELECT array_agg(q.v + (random() - 0.5) * 0.05 + 0 * g ORDER BY q.i)
               FROM unnest(${`{${qv.join(",")}}`}::real[]) WITH ORDINALITY AS q(v, i))::vector
          FROM generate_series(1, 2000) AS g`);
        // As in the test above: leave the planner only the HNSW index for the ORDER BY.
        await tx.execute(sql`DROP INDEX kb_chunks_site_idx`);
        await tx.execute(sql`DROP INDEX kb_chunks_source_idx`);
        await tx.execute(sql`ANALYZE kb_chunks`);
        // Starve the HNSW iterative scan: through the index, the small site would get nothing back.
        await tx.execute(sql`SET LOCAL hnsw.max_scan_tuples = 50`);
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        hits = await searchKnowledge(small.id, "argan oil", 6, tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(hits.map((h) => h.sourceId)).toEqual([smallSrc.id]);
  });
});

