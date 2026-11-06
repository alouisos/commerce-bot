import { requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/app/sites/[siteId]/settings/greeting-image">) {
  const { siteId } = await ctx.params;
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
  if (!site.greetingImageKey) return new Response("Not found", { status: 404 });
  const obj = await getStorage().get(site.greetingImageKey);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Blob([obj.body as BlobPart], { type: obj.contentType }), {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" },
  });
}
