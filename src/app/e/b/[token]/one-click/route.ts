import { unsubscribeBuyer } from "@/lib/buyers/feedback";
import { buyerUnsubscribePageUrl } from "@/lib/email/render";

// RFC 8058 one-click unsubscribe: mail clients POST here. The answer is the same for any token.
export async function POST(_req: Request, ctx: RouteContext<"/e/b/[token]/one-click">): Promise<Response> {
  const { token } = await ctx.params;
  await unsubscribeBuyer(token);
  return new Response("Unsubscribed.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Opening the address (a scanner, or a client without one-click) shows the page with its button instead.
export async function GET(_req: Request, ctx: RouteContext<"/e/b/[token]/one-click">): Promise<Response> {
  const { token } = await ctx.params;
  return new Response(null, { status: 303, headers: { Location: buyerUnsubscribePageUrl(encodeURIComponent(token)) } });
}
