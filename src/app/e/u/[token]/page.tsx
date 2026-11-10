import type { Metadata } from "next";
import { emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { unsubscribeState } from "@/lib/email/links";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { robots: { index: false } };

// Mail scanners open links, so opening this page never unsubscribes: the button does.
export default async function UnsubscribePage({ params }: PageProps<"/e/u/[token]">) {
  const { token } = await params;
  const { state, siteName, language: lang } = await unsubscribeState(token);
  const { language, copy } = emailCopyFor(lang);
  return (
    <main lang={language} className="mx-auto flex max-w-md flex-col gap-4 p-8">
      {state === "unsubscribed" && <p>{fillSite(copy.unsubscribed, siteName)}</p>}
      {state === "subscribed" && (
        <form action={unsubscribeAction.bind(null, token)} className="flex flex-col gap-4">
          <p>{fillSite(copy.unsubscribePrompt, siteName)}</p>
          <button type="submit" className="w-fit border p-2">
            {copy.unsubscribeButton}
          </button>
        </form>
      )}
      {state === "invalid" && <p>{copy.invalidLink}</p>}
    </main>
  );
}
