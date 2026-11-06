import { findOwnedConversation, getStoredMessages } from "@/lib/widget/conversation";
import { json, preflight, resolveWidgetRequest, WidgetError, withWidgetErrors } from "@/lib/widget/guard";

export const GET = withWidgetErrors(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const { site, origin } = await resolveWidgetRequest(req, key);
  const sid = url.searchParams.get("sid");
  const cid = await findOwnedConversation(site.id, sid ?? "", url.searchParams.get("cid"));
  if (!sid || !cid) throw new WidgetError(404, "Not found");
  return json({ messages: await getStoredMessages(site.id, site.publicKey, cid) }, 200, origin);
});

export const OPTIONS = preflight;
