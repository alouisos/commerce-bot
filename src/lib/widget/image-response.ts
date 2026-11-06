import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { getSiteByPublicKey } from "@/lib/sites";
import { getStorage } from "@/lib/storage";
import { isUuid } from "@/lib/widget/conversation";
import { WidgetError } from "@/lib/widget/guard";

async function serve(storageKey: string | null): Promise<Response> {
  if (!storageKey) throw new WidgetError(404, "Not found");
  const obj = await getStorage().get(storageKey);
  if (!obj) throw new WidgetError(404, "Not found");
  return new Response(obj.body as BodyInit, {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function serveSourceImage(key: string | null, sourceId: string): Promise<Response> {
  const site = key ? await getSiteByPublicKey(key) : null;
  if (!site || !isUuid(sourceId)) throw new WidgetError(404, "Not found");
  const [src] = await db
    .select({ storageKey: kbSources.storageKey })
    .from(kbSources)
    .where(and(eq(kbSources.id, sourceId), eq(kbSources.siteId, site.id), eq(kbSources.kind, "image")));
  return serve(src?.storageKey ?? null);
}

export async function serveGreetingImage(key: string | null): Promise<Response> {
  const site = key ? await getSiteByPublicKey(key) : null;
  if (!site) throw new WidgetError(404, "Not found");
  return serve(site.greetingImageKey);
}
