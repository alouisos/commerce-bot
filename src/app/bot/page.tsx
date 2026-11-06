import { PRODUCT_NAME } from "@/lib/brand";
import { env } from "@/lib/env";

export const metadata = { title: "ConciergeBot" };

export default function BotPage() {
  const appUrl = env.APP_URL.replace(/\/+$/, "");
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">ConciergeBot</h1>
      <p>
        ConciergeBot is the web crawler for the {PRODUCT_NAME} chatbot service. It only visits websites whose owners
        have added them to {PRODUCT_NAME}, to read their pages so the site&apos;s chatbot can answer visitors.
      </p>
      <p>
        Its user agent is: <code>ConciergeBot/1.0 (+{appUrl}/bot)</code>
      </p>
      <h2 className="text-lg font-semibold">How to block it</h2>
      <p>Add this to your robots.txt:</p>
      <pre className="border p-3">
        {`User-agent: ConciergeBot
Disallow: /`}
      </pre>
      <p>
        ConciergeBot follows the rules in a <code>User-agent: ConciergeBot</code> group if you have one, and
        otherwise the rules in your <code>User-agent: *</code> group.
      </p>
    </main>
  );
}
