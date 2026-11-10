import Link from "next/link";
import type { ReactNode } from "react";
import { plural, relativeTime } from "@/lib/format";
import { latestInsight } from "@/lib/insights/schedule";
import { RefreshInsightsButton } from "./refresh-button";

function List<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="font-medium">{title}</h4>
      <ul className="list-disc pl-5 text-sm">{items.map((it, i) => <li key={i}>{render(it)}</li>)}</ul>
    </div>
  );
}

/** The site's latest AI insights. Callers must have checked access to the site. */
export async function InsightsSection({ siteId }: { siteId: string }) {
  const insight = await latestInsight(siteId);
  return (
    <section id="insights" className="flex flex-col gap-3 border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Insights</h3>
        <RefreshInsightsButton siteId={siteId} />
      </div>
      {!insight ? (
        <p className="text-sm">Insights appear after your bot&apos;s first conversations. They refresh every day.</p>
      ) : (
        <>
          <p className="text-sm opacity-80">
            Updated <time dateTime={insight.createdAt.toISOString()}>{relativeTime(insight.createdAt)}</time> from{" "}
            {plural(insight.conversationCount, "conversation")}. Written by AI from your conversations; check before
            acting on it.
          </p>
          <p className="whitespace-pre-wrap">{insight.content.summary}</p>
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
              <Link href={`/app/sites/${siteId}/knowledge`} className="underline">
                Add the missing answers in Knowledge
              </Link>
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
    </section>
  );
}
