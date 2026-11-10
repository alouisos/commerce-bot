import { and, cosineDistance, count, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources } from "@/db/schema";
import { getEmbedder } from "@/lib/ai/embed";

export type KnowledgeHit = {
  sourceId: string;
  kind: "document" | "image" | "text" | "page";
  title: string;
  caption: string | null;
  url: string | null;
  content: string;
  score: number;
};

/** Sites with up to this many chunks are searched exactly (a few ms), bigger ones through the index. */
export const EXACT_SEARCH_MAX_CHUNKS = 20_000;

/** Anything that can open a transaction: the db, or an outer transaction (tests). */
type Executor = Pick<typeof db, "transaction">;

/** Top-k ready, non-excluded sources of a site by cosine similarity; chunks of one source collapse to the best. */
export async function searchKnowledge(
  siteId: string,
  query: string,
  k = 6,
  executor: Executor = db,
): Promise<KnowledgeHit[]> {
  const [qv] = await getEmbedder().embed([query], "query");
  const distance = cosineDistance(kbChunks.embedding, qv);
  const rows = await executor.transaction(async (tx) => {
    // Most sites are small: rank all of their chunks exactly. `+ 0` keeps the planner off the shared
    // HNSW index, which (being approximate and shared by every site) can return nothing for a small site
    // next to a big one. Only big sites use the index, with iterative scan.
    const [{ n }] = await tx.select({ n: count() }).from(kbChunks).where(eq(kbChunks.siteId, siteId));
    const exact = n <= EXACT_SEARCH_MAX_CHUNKS;
    // HNSW returns its ef_search nearest candidates before the site filter applies, so a small site
    // among big ones can get nothing back. Iterative scan keeps scanning until enough rows pass the
    // filter (pgvector >= 0.8). relaxed_order may return rows slightly out of order: re-sorted below.
    // The scan also stops once it uses work_mem × scan_mem_multiplier (default 1 × 4 MB, about 1,000
    // 1024-dim vectors), which a big neighbouring site can exhaust first; allow 8×.
    await tx.execute(
      sql`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true), set_config('hnsw.ef_search', '100', true),
        set_config('hnsw.scan_mem_multiplier', '8', true)`,
    );
    return tx
      .select({
        sourceId: kbSources.id,
        kind: kbSources.kind,
        title: kbSources.title,
        caption: kbSources.caption,
        url: kbSources.url,
        content: kbChunks.content,
        score: sql<number>`1 - (${distance})`,
      })
      .from(kbChunks)
      .innerJoin(kbSources, eq(kbChunks.sourceId, kbSources.id))
      .where(
        and(
          eq(kbChunks.siteId, siteId),
          eq(kbSources.siteId, siteId),
          eq(kbSources.status, "ready"),
          eq(kbSources.excluded, false),
        ),
      )
      .orderBy(exact ? sql`(${distance}) + 0` : distance)
      .limit(k * 4);
  });
  rows.sort((a, b) => Number(b.score) - Number(a.score));

  const seen = new Set<string>();
  const hits: KnowledgeHit[] = [];
  for (const r of rows) {
    if (seen.has(r.sourceId)) continue;
    seen.add(r.sourceId);
    hits.push({ ...r, score: Number(r.score) });
    if (hits.length === k) break;
  }
  return hits;
}
