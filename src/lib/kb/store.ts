import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks } from "@/db/schema";
import { getEmbedder } from "@/lib/ai/embed";

/** Replaces all chunks of a source. Embeds before opening the transaction. */
export async function replaceChunks(input: { sourceId: string; siteId: string; texts: string[] }): Promise<number> {
  const { sourceId, siteId, texts } = input;
  const vectors = texts.length ? await getEmbedder().embed(texts, "document") : [];
  await db.transaction(async (tx) => {
    await tx.delete(kbChunks).where(eq(kbChunks.sourceId, sourceId));
    if (texts.length) {
      await tx
        .insert(kbChunks)
        .values(texts.map((content, ordinal) => ({ sourceId, siteId, ordinal, content, embedding: vectors[ordinal] })));
    }
  });
  return texts.length;
}
