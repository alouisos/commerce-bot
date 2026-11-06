import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/app/sites/[siteId]/knowledge/image/[sourceId]">) {
  const { siteId, sourceId } = await ctx.params;
  const user = await requireUser();
  try {
    await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
  if (!UUID_RE.test(sourceId)) return new Response("Not found", { status: 404 });
  const [source] = await db
    .select()
    .from(kbSources)
    .where(and(eq(kbSources.id, sourceId), eq(kbSources.siteId, siteId), eq(kbSources.kind, "image")));
  if (!source?.storageKey) return new Response("Not found", { status: 404 });
  const obj = await getStorage().get(source.storageKey);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Blob([obj.body as BlobPart], { type: obj.contentType }), {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" },
  });
}
