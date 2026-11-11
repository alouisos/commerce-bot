import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation } from "@/lib/conversations/detail";
import { httpUrl, relativeTime, money } from "@/lib/format";
import { ArrowLeftIcon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { INTENT_LABELS } from "@/shared/intent";
import { loadSite } from "../../load-site";

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default async function ConversationPage({
  params,
}: PageProps<"/app/sites/[siteId]/conversations/[conversationId]">) {
  const { siteId, conversationId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const found = await getConversation(site.id, conversationId);
  if (!found) notFound();
  const { conversation, messages, leads, prompt, sales } = found;
  const visitPages = conversation.visit?.pages ?? [];
  const page = httpUrl(conversation.firstPageUrl);
  const now = new Date();

  const pagesVisited = visitPages.length > 0 && (
    <section className="panel">
      <h3 className="panel-head">Pages this visit</h3>
      <ol className="panel-body flex flex-col gap-2 text-sm">
        {visitPages.map((p, i) => {
          const href = httpUrl(p.url);
          const title = p.title || p.url;
          return (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words">
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {title}
                  </a>
                ) : (
                  title
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-ink-subtle tabular-nums">{p.seconds}s</span>
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/app/sites/${site.id}/conversations`} className="inline-flex items-center gap-1.5 self-start text-sm">
        <ArrowLeftIcon /> All conversations
      </Link>
      <header className="flex flex-col gap-1.5">
        <h2 className="text-2xl">Conversation</h2>
        <p className="text-sm text-ink-muted">
          Started <time dateTime={conversation.createdAt.toISOString()}>{utc(conversation.createdAt)}</time> ·
          Language: {conversation.language}
          {conversation.firstPageUrl && (
            <>
              {" "}
              · First page:{" "}
              {page ? (
                <a href={page} className="break-all" target="_blank" rel="noreferrer">
                  {conversation.firstPageUrl}
                </a>
              ) : (
                conversation.firstPageUrl
              )}
            </>
          )}
        </p>
        {conversation.intent && (
          <p className="text-sm text-ink-muted">
            Intent: {INTENT_LABELS[conversation.intent]}
            {conversation.intentConfidence !== null && ` (${Math.round(conversation.intentConfidence * 100)}%)`}
          </p>
        )}
        {prompt && <p className="text-sm text-ink-muted">Started from a suggestion: “{prompt.text}”</p>}
        {sales.map((s) => (
          <p key={s.id} className="text-sm font-semibold text-sodium">
            {s.amountMinor !== null && s.currency
              ? `Sale followed: ${money(s.amountMinor, s.currency)}`
              : "Sale followed (amount unknown)"}
            {s.externalId ? ` · order #${s.externalId}` : ""}
          </p>
        ))}
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <ol className="flex max-w-3xl flex-col gap-3" aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={m.role === "visitor" ? "msg msg-visitor" : "msg msg-bot"}>
              <div className="msg-who">
                {m.role === "visitor" ? "Visitor" : site.botName}
                {m.kind === "fallback" && <span className="badge badge-warn">Couldn&apos;t answer</span>}
                <time dateTime={m.createdAt.toISOString()} className="text-xs font-normal text-ink-subtle">
                  {utc(m.createdAt)}
                </time>
              </div>
              {m.role === "bot" ? <Markdown text={m.content} /> : <div className="whitespace-pre-wrap">{m.content}</div>}
            </li>
          ))}
        </ol>
        <aside className="flex flex-col gap-4">
          <section className="panel">
            <h3 className="panel-head">Email</h3>
            <div className="panel-body">
              {leads.length === 0 ? (
                <p className="text-sm text-ink-muted">No email captured</p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {leads.map((l) => (
                    <li key={l.id}>
                      <strong className="break-all">{l.email}</strong> ·{" "}
                      <time dateTime={l.createdAt.toISOString()} className="text-ink-muted">
                        {relativeTime(l.createdAt, now)}
                      </time>
                      <div className="mt-1 whitespace-pre-wrap text-ink-muted">{l.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          {pagesVisited}
        </aside>
      </div>
    </div>
  );
}
