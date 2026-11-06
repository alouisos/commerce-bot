import { and, cosineDistance, eq, sql } from "drizzle-orm";
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

/** Top-k ready, non-excluded sources of a site by cosine similarity; chunks of one source collapse to the best. */
export async function searchKnowledge(siteId: string, query: string, k = 6): Promise<KnowledgeHit[]> {
  const [qv] = await getEmbedder().embed([query], "query");
  const distance = cosineDistance(kbChunks.embedding, qv);
  const rows = await db
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
    .orderBy(distance)
    .limit(k * 4);

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
