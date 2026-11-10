import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { listLeads } from "@/lib/leads";
import { DeletePersonForm } from "../emails/delete-person-form";
import { loadSite } from "../load-site";

export default async function LeadsPage({ params }: PageProps<"/app/sites/[siteId]/leads">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const rows = await listLeads(site.id);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl">Leads</h2>
      <p className="max-w-[72ch] text-sm text-ink-muted">
        Visitors who left their email when the bot couldn&apos;t answer, or asked for recommendations by email. Newest
        first.
      </p>
      {rows.length === 0 ? (
        <p className="notice">No leads yet. They appear here when a visitor leaves their email in a chat.</p>
      ) : (
        <div className="panel table-wrap table-stack">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Message</th>
              <th>Received</th>
              <th>Conversation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="stack-lead break-words font-medium">{l.email}</td>
                <td className="stack-full min-w-64 whitespace-pre-wrap text-ink-muted">{l.message}</td>
                <td data-label="Received" className="whitespace-nowrap text-ink-muted">
                  <time dateTime={l.createdAt.toISOString()}>{relativeTime(l.createdAt, now)}</time>
                </td>
                <td>
                  {l.conversationId && (
                    <Link href={`/app/sites/${site.id}/conversations/${l.conversationId}`}>
                      View
                    </Link>
                  )}
                </td>
                <td>
                  <DeletePersonForm siteId={site.id} email={l.email} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
