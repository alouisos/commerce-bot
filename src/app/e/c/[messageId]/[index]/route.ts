import { trackClick } from "@/lib/email/links";

// Only links stored on a sent email are reachable: this is not an open redirect.
export async function GET(_req: Request, ctx: RouteContext<"/e/c/[messageId]/[index]">): Promise<Response> {
  const { messageId, index } = await ctx.params;
  const target = /^\d{1,3}$/.test(index) ? await trackClick(messageId, Number(index)) : null;
  if (!target) {
    return new Response("This link isn't valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
}
