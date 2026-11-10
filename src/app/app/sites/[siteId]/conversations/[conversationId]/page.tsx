import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation } from "@/lib/conversations/detail";
import { httpUrl, relativeTime } from "@/lib/format";
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
  const { conversation, messages, leads, prompt } = found;
  const visitPages = conversation.visit?.pages ?? [];
  const page = httpUrl(conversation.firstPageUrl);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/app/sites/${site.id}/conversations`} className="text-sm underline">
        ← All conversations
      </Link>
      <header>
        <h2 className="text-lg font-semibold">Conversation</h2>
        <p className="text-sm">
          Started <time dateTime={conversation.createdAt.toISOString()}>{utc(conversation.createdAt)}</time> ·
          Language: {conversation.language}
          {conversation.firstPageUrl && (
            <>
              {" "}
              · First page:{" "}
              {page ? (
                <a href={page} className="underline" target="_blank" rel="noreferrer">
                  {conversation.firstPageUrl}
                </a>
              ) : (
                conversation.firstPageUrl
              )}
            </>
          )}
        </p>
        {conversation.intent && (
          <p className="text-sm">
            Intent: {INTENT_LABELS[conversation.intent]}
            {conversation.intentConfidence !== null && ` (${Math.round(conversation.intentConfidence * 100)}%)`}
          </p>
        )}
        {prompt && <p className="text-sm">Started from a suggestion: “{prompt.text}”</p>}
      </header>
      {visitPages.length > 0 && (
        <section>
          <h3 className="font-medium">Pages this visit</h3>
          <ol className="text-sm">
            {visitPages.map((p, i) => {
              const href = httpUrl(p.url);
              const title = p.title || p.url;
              return (
                <li key={i}>
                  {href ? (
                    <a href={href} className="underline" target="_blank" rel="noreferrer">
                      {title}
                    </a>
                  ) : (
                    title
                  )}{" "}
                  · {p.seconds}s
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <section className="border p-3">
        <h3 className="font-medium">Email</h3>
        {leads.length === 0 ? (
          <p className="text-sm">No email captured</p>
        ) : (
          <ul className="text-sm">
            {leads.map((l) => (
              <li key={l.id}>
                <strong>{l.email}</strong> ·{" "}
                <time dateTime={l.createdAt.toISOString()}>{relativeTime(l.createdAt, now)}</time>
                <div className="whitespace-pre-wrap">{l.message}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ol className="flex flex-col gap-3">
        {messages.map((m) => (
          <li key={m.id} className={m.role === "visitor" ? "border-l-4 pl-3" : "border-l-4 border-blue-400 pl-3"}>
            <div className="text-sm font-medium">
              {m.role === "visitor" ? "Visitor" : site.botName}
              {m.kind === "fallback" && (
                <span className="ml-2 border border-amber-400 bg-amber-50 px-1 text-xs text-amber-900">
                  Couldn&apos;t answer
                </span>
              )}
              <time dateTime={m.createdAt.toISOString()} className="ml-2 text-xs font-normal opacity-70">
                {utc(m.createdAt)}
              </time>
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
