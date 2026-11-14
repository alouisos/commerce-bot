import { buildWidgetConfig, touchLastSeen } from "@/lib/widget/config";
import { json, preflight, resolveWidgetRequest, withWidgetErrors } from "@/lib/widget/guard";
import { isValidTestKey } from "@/lib/widget/test-mode";

export const GET = withWidgetErrors(async (req) => {
  const url = new URL(req.url);
  const { site, origin } = await resolveWidgetRequest(req, url.searchParams.get("key"));
  await touchLastSeen(site.id);
  const testMode = isValidTestKey(site.publicKey, url.searchParams.get("test"));
  const config = await buildWidgetConfig(site, url.searchParams.get("lang"), new Date(), { testMode });
  return json(config, 200, origin);
});

export const OPTIONS = preflight;
