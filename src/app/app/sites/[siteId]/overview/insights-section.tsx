import Link from "next/link";
import type { ReactNode } from "react";
import { plural, relativeTime } from "@/lib/format";
import { latestInsight } from "@/lib/insights/schedule";
import { pausedKinds } from "@/lib/prompts/backoff";
import { PROMPT_KIND_LABELS } from "./prompt-performance";
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

/** The site's latest AI insights. Callers must have checked access to the site. */
export async function InsightsSection({ siteId }: { siteId: string }) {
  const [insight, paused] = await Promise.all([latestInsight(siteId), pausedKinds(siteId)]);
  return (
    <section id="insights" className="panel">
      <div className="panel-head">
        <h3>Insights</h3>
        <RefreshInsightsButton siteId={siteId} />
      </div>
      <div className="panel-body flex flex-col gap-4">
      <List
        title="Prompts visitors keep dismissing"
        items={paused}
        render={(k) => <>{PROMPT_KIND_LABELS[k]}: paused for now, so visitors stop seeing them.</>}
      />
      {!insight ? (
        <p className="text-sm text-ink-muted">Insights appear after your bot&apos;s first conversations. They refresh every day.</p>
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
