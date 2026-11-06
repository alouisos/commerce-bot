import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources, sites } from "@/db/schema";
import { describeImage } from "@/lib/ai/describe-image";
import { ValidationError } from "@/lib/errors";
import { chunkText } from "@/lib/kb/chunk";
import { extractText } from "@/lib/kb/extract";
import { replaceChunks } from "@/lib/kb/store";
import { getStorage } from "@/lib/storage";
import { recordModelUsage } from "@/lib/usage/meter";

const GENERIC_ERROR = "Processing failed. Please try again or upload a different file.";

class UserFacingError extends Error {}

export async function ingestSource(sourceId: string): Promise<void> {
  const [source] = await db.select().from(kbSources).where(eq(kbSources.id, sourceId));
  if (!source) return;
  await db.update(kbSources).set({ status: "processing", error: null }).where(eq(kbSources.id, sourceId));
  try {
    if (!source.storageKey) throw new UserFacingError("The uploaded file is missing");
    const obj = await getStorage().get(source.storageKey);
    if (!obj) throw new UserFacingError("The uploaded file is missing");
    const mimeType = source.mimeType ?? obj.contentType;

    if (source.kind === "image") {
      const [site] = await db.select().from(sites).where(eq(sites.id, source.siteId));
      if (!site) throw new UserFacingError("The website no longer exists");
      const result = await describeImage({
        bytes: obj.body,
        mimeType,
        caption: source.caption ?? undefined,
      });
      const caption = source.caption ?? result.caption;
      await replaceChunks({
        sourceId,
        siteId: source.siteId,
        texts: [`[Image: ${caption}]\n${result.description}`],
      });
      await recordModelUsage({
        accountId: site.accountId,
        siteId: site.id,
        kind: "image_description",
        model: result.model,
        usage: result.usage,
      });
      await db.update(kbSources).set({ caption, status: "ready", error: null }).where(eq(kbSources.id, sourceId));
      return;
    }

    const text = await extractText(obj.body, mimeType);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new UserFacingError("No readable text found in this file");
    await replaceChunks({ sourceId, siteId: source.siteId, texts: chunks });
    await db.update(kbSources).set({ status: "ready", error: null }).where(eq(kbSources.id, sourceId));
  } catch (err) {
    let message = GENERIC_ERROR;
    if (err instanceof UserFacingError || err instanceof ValidationError) message = err.message;
    else console.error(`[ingest] source ${sourceId} failed`, err);
    await db.update(kbSources).set({ status: "failed", error: message }).where(eq(kbSources.id, sourceId));
  }
}
