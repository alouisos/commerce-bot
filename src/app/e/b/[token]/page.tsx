import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buyerUnsubscribeState } from "@/lib/buyers/feedback";
import { emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { unsubscribeBuyerAction } from "./actions";

export const metadata: Metadata = { robots: { index: false } };

// Mail scanners open links, so opening this page never unsubscribes: the button does.
export default async function BuyerUnsubscribePage({ params }: PageProps<"/e/b/[token]">) {
  const { token } = await params;
  const s = await buyerUnsubscribeState(token);
  if (!s) notFound();
  const { language, copy } = emailCopyFor(s.language);
  return (
    <main lang={language} className="mx-auto flex max-w-md flex-col gap-4 p-8">
      {s.state === "unsubscribed" ? (
        <p>{fillSite(copy.unsubscribed, s.siteName)}</p>
      ) : (
        <form action={unsubscribeBuyerAction.bind(null, token)} className="flex flex-col gap-4">
          <p>{fillSite(copy.unsubscribePrompt, s.siteName)}</p>
          <button type="submit" className="w-fit border p-2">
            {copy.unsubscribeButton}
          </button>
        </form>
      )}
    </main>
  );
}
