import { createLead } from "@/lib/widget/lead";
import { clientIp, json, preflight, resolveWidgetRequest, withWidgetErrors } from "@/lib/widget/guard";

export const POST = withWidgetErrors(async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  const { site, origin } = await resolveWidgetRequest(req, key);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  await createLead(site, body, clientIp(req));
  return json({ ok: true }, 201, origin);
});

export const OPTIONS = preflight;
