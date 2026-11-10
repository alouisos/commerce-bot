import type { Metadata } from "next";
import { emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { confirmState } from "@/lib/email/contacts";
import { confirmAction } from "./actions";

export const metadata: Metadata = { robots: { index: false } };

// Mail scanners open links, so opening this page never confirms: the visitor presses the button.
export default async function ConfirmPage({ params }: PageProps<"/e/confirm/[token]">) {
  const { token } = await params;
  const { state, siteName, language: lang } = await confirmState(token);
  const { language, copy } = emailCopyFor(lang);
  return (
    <main lang={language} className="mx-auto flex max-w-md flex-col gap-4 p-8">
      {state === "subscribed" && <p>{fillSite(copy.confirmed, siteName)}</p>}
      {state === "confirmable" && (
        <form action={confirmAction.bind(null, token)} className="flex flex-col gap-4">
          <p>{fillSite(copy.confirmPrompt, siteName)}</p>
          <button type="submit" className="w-fit border p-2">
            {copy.confirmButton}
          </button>
        </form>
      )}
      {state === "invalid" && <p>{copy.invalidLink}</p>}
    </main>
  );
}
