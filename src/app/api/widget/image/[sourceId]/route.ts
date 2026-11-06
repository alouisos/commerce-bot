import { withWidgetErrors } from "@/lib/widget/guard";
import { serveSourceImage } from "@/lib/widget/image-response";

export const GET = withWidgetErrors(async (req, ctx: { params: Promise<{ sourceId: string }> }) => {
  const { sourceId } = await ctx.params;
  return serveSourceImage(new URL(req.url).searchParams.get("key"), sourceId);
});
