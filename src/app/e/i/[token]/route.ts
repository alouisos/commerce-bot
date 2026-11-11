import { turnOffInsightsEmail } from "@/lib/insights/email";

const page = (message: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Daily insights email</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem"><p>${message}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

// Opening the link in the email turns the daily insights email off and says so. It is switched back on
// from the Insights panel on the Overview page.
export async function GET(_req: Request, ctx: RouteContext<"/e/i/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  if (!(await turnOffInsightsEmail(token))) return page("This link isn&rsquo;t valid any more.", 404);
  return page("Done. You won&rsquo;t get the daily insights email any more. You can turn it back on from the Insights panel on your Overview page.", 200);
}

// RFC 8058 one-click: mail clients POST here (List-Unsubscribe-Post).
export async function POST(_req: Request, ctx: RouteContext<"/e/i/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  await turnOffInsightsEmail(token);
  return new Response("Done.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
