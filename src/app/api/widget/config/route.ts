import { buildWidgetConfig, touchLastSeen } from "@/lib/widget/config";
import { json, preflight, resolveWidgetRequest, withWidgetErrors } from "@/lib/widget/guard";

export const GET = withWidgetErrors(async (req) => {
  const url = new URL(req.url);
  const { site, origin } = await resolveWidgetRequest(req, url.searchParams.get("key"));
  await touchLastSeen(site.id);
  const config = await buildWidgetConfig(site, url.searchParams.get("lang"));
  return json(config, 200, origin);
});

export const OPTIONS = preflight;
