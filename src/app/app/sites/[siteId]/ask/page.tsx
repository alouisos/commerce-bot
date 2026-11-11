import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { ASK_ERRORS, QUESTION_MAX } from "@/lib/ask/answer";
import { LOOKBACK_DAYS } from "@/lib/ask/search";
import { ownerAiBlocked } from "@/lib/usage/meter";
import { loadSite } from "../load-site";
import { AskChat } from "./ask-chat";

export default async function AskPage({ params }: PageProps<"/app/sites/[siteId]/ask">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, site.accountId)).limit(1);
  const blocked = account ? await ownerAiBlocked(account) : false;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl">Ask the Concierge</h2>
      <p className="max-w-[72ch] text-sm text-ink-muted">
        Ask anything about what visitors said to {site.botName} in the last {LOOKBACK_DAYS} days. Answers come only from
        your conversations, with links to the ones they rely on. Visitors&apos; email addresses are never shown. The
        thread is not saved: it clears when you leave this page.
      </p>
      {blocked && (
        <p role="status" className="notice notice-warn text-sm">
          {ASK_ERRORS.blocked}
        </p>
      )}
      <AskChat siteId={site.id} questionMax={QUESTION_MAX} disabled={blocked} />
    </div>
  );
}
