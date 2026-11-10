import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { listLeads } from "@/lib/leads";
import { loadSite } from "../load-site";

export default async function LeadsPage({ params }: PageProps<"/app/sites/[siteId]/leads">) {
  const { siteId } = await params;
  // requireUser + requireSiteAccess (404 otherwise), checked here and not only in the layout.
  const site = await loadSite(siteId);
  const rows = await listLeads(site.id);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Leads</h2>
      <p className="text-sm">Visitors who left their email when the bot couldn&apos;t answer. Newest first.</p>
      {rows.length === 0 ? (
        <p>No leads yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Email</th>
              <th>Message</th>
              <th>Received</th>
              <th>Conversation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="py-1">{l.email}</td>
                <td className="whitespace-pre-wrap">{l.message}</td>
                <td>
                  <time dateTime={l.createdAt.toISOString()}>{relativeTime(l.createdAt, now)}</time>
                </td>
                <td>
                  {l.conversationId && (
                    <Link href={`/app/sites/${site.id}/conversations/${l.conversationId}`} className="underline">
                      View
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
