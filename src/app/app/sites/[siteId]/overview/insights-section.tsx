import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sites } from "@/db/schema";
import type { ReactNode } from "react";
import { plural, relativeTime } from "@/lib/format";
import { INSIGHT_WINDOWS, WINDOW_LABELS, type InsightWindow } from "@/lib/insights/prompt";
import { isInsightFresh, latestInsight } from "@/lib/insights/schedule";
import { ownerAiBlocked } from "@/lib/usage/meter";
import { pausedKinds } from "@/lib/prompts/backoff";
import { PROMPT_KIND_LABELS } from "./prompt-performance";
import { insightsEmailOn } from "@/lib/insights/email";
import { InsightsEmailToggle } from "./email-toggle";
import { RefreshInsightsButton } from "./refresh-button";

function List<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm text-ink-muted">{title}</h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm marker:text-teal">{items.map((it, i) => <li key={i}>{render(it)}</li>)}</ul>
    </div>
  );
}

/** The site's latest AI insights for one window. Callers must have checked access to the site. */
export async function InsightsSection({
  siteId,
  window = "24h",
  params = {},
  userId,
  now = new Date(),
}: {
  siteId: string;
  window?: InsightWindow;
  /** The page's search params, kept in the window links. */
  params?: Record<string, string | undefined>;
  /** The signed-in member; when given, the panel shows their daily-email switch. */
  userId?: string;
  now?: Date;
}) {
  const [latest, paused, [row]] = await Promise.all([
    latestInsight(siteId, window),
    pausedKinds(siteId),
    db.select({ account: accounts }).from(sites).innerJoin(accounts, eq(accounts.id, sites.accountId)).where(eq(sites.id, siteId)).limit(1),
  ]);
  const blocked = row ? await ownerAiBlocked(row.account) : false;
  const emailOn = userId && row ? await insightsEmailOn(userId, row.account.id) : null;
  // A quiet site keeps its last insight; one older than its window isn't that window's insight.
  const insight = latest && isInsightFresh(latest, window, now) ? latest : null;
  const href = (w: InsightWindow) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "insights") q.set(k, v);
    q.set("insights", w);
    return `/app/sites/${siteId}/overview?${q}#insights`;
  };
  return (
    <section id="insights" className="panel">
      <div className="panel-head">
        <h3>Insights</h3>
        <nav aria-label="Insights period" className="seg">
          {INSIGHT_WINDOWS.map((w) => (
            <Link key={w} href={href(w)} aria-current={w === window ? "page" : undefined}>
              {WINDOW_LABELS[w]}
            </Link>
          ))}
        </nav>
        <RefreshInsightsButton siteId={siteId} window={window} disabled={blocked} />
        <Link href={`/app/sites/${siteId}/ask`} className="btn btn-sm">
          Ask the Concierge
        </Link>
        {emailOn !== null && <InsightsEmailToggle siteId={siteId} on={emailOn} />}
      </div>
      <div className="panel-body flex flex-col gap-4">
      {blocked && (
        <p role="status" className="notice text-sm">
          Insights are paused until next month: this month&apos;s owner AI budget is used up.
        </p>
      )}
      <List
        title="Prompts visitors keep dismissing"
        items={paused}
        render={(k) => <>{PROMPT_KIND_LABELS[k]}: paused for now, so visitors stop seeing them.</>}
      />
      {!insight ? (
        <p className="text-sm text-ink-muted">
          Not enough conversations in this period. Insights appear after your bot&apos;s first conversations. They refresh
          every day.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-subtle">
            Updated <time dateTime={insight.createdAt.toISOString()}>{relativeTime(insight.createdAt)}</time> from{" "}
            {plural(insight.conversationCount, "conversation")}. Written by AI from your conversations; check before
            acting on it.
          </p>
          <p className="max-w-[72ch] whitespace-pre-wrap">{insight.content.summary}</p>
          <List
            title="What people ask most"
            items={insight.content.topQuestions}
            render={(q) => (
              <>
                <strong>{q.topic}</strong>: {q.detail}
              </>
            )}
          />
          <List
            title="Questions the bot couldn't answer well"
            items={insight.content.knowledgeGaps}
            render={(g) => (
              <>
                <strong>{g.question}</strong> {g.suggestion}
              </>
            )}
          />
          {insight.content.knowledgeGaps.length > 0 && (
            <p className="text-sm">
              <Link href={`/app/sites/${siteId}/knowledge`}>Add the missing answers in Knowledge</Link>
            </p>
          )}
          <List
            title="Worries before buying"
            items={insight.content.objections}
            render={(o) => (
              <>
                <strong>{o.concern}</strong>: {o.detail}
              </>
            )}
          />
          <List
            title="Products people are curious about"
            items={insight.content.curiousProducts}
            render={(p) => (
              <>
                <strong>{p.product}</strong>: {p.note}
              </>
            )}
          />
        </>
      )}
      </div>
    </section>
  );
}
