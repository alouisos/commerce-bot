import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { listPeople, listQueue, listSent } from "@/lib/email/admin";
import { effectiveEmailMode } from "@/lib/site-settings";
import { loadSite } from "../load-site";
import { DeletePersonForm } from "./delete-person-form";
import { DraftEditor } from "./draft-editor";

const TABS = [
  { id: "queue", label: "Queue" },
  { id: "sent", label: "Sent" },
  { id: "people", label: "People" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const STATUS = { pending: "Not confirmed", subscribed: "Subscribed", unsubscribed: "Unsubscribed" } as const;

export default async function EmailsPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/emails">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "queue";
  const [account] = await db.select().from(accounts).where(eq(accounts.id, site.accountId));
  const automatic = effectiveEmailMode(site, account) === "automatic";
  const base = `/app/sites/${site.id}/emails`;
  // Awaited here rather than nested as async components (renderToStaticMarkup can't suspend).
  const body =
    tab === "queue"
      ? await Queue({ siteId: site.id })
      : tab === "sent"
        ? await Sent({ siteId: site.id, page: Number(sp.page ?? 1), base })
        : await People({ siteId: site.id });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Emails</h2>
      {site.sendingDomainStatus !== "verified" && (
        <p role="status" className="border p-2">
          Set up your sending domain in Settings before emails can go out.{" "}
          <Link href={`/app/sites/${site.id}/settings`} className="underline">
            Settings
          </Link>
        </p>
      )}
      {automatic && (
        <p role="status" className="border p-2">
          Emails send automatically. Switch to approval in Settings to review them first.
        </p>
      )}
      <nav aria-label="Emails" className="flex gap-4">
        {TABS.map((t) => (
          <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}
            className={t.id === tab ? "font-semibold underline" : "underline"}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

async function Queue({ siteId }: { siteId: string }) {
  const drafts = await listQueue(siteId);
  if (drafts.length === 0) return <p>No emails waiting for approval.</p>;
  return (
    <div className="flex flex-col gap-4">
      {drafts.map((d) => (
        <DraftEditor key={d.id} siteId={siteId} draft={d} />
      ))}
    </div>
  );
}

async function Sent({ siteId, page, base }: { siteId: string; page: number; base: string }) {
  const sent = await listSent(siteId, page);
  if (sent.total === 0) return <p>No emails sent yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>Sent at</th>
            <th>To</th>
            <th>Subject</th>
            <th>Clicks</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          {sent.rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1">{r.sentAt ? r.sentAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
              <td>{r.email}</td>
              <td>{r.subject}</td>
              <td>{r.clicks}</td>
              <td>{r.sales}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sent.pages > 1 && (
        <p className="flex gap-4 text-sm">
          {sent.page > 1 && <Link href={`${base}?tab=sent&page=${sent.page - 1}`}>Newer</Link>}
          <span>
            Page {sent.page} of {sent.pages}
          </span>
          {sent.page < sent.pages && <Link href={`${base}?tab=sent&page=${sent.page + 1}`}>Older</Link>}
        </p>
      )}
    </div>
  );
}

async function People({ siteId }: { siteId: string }) {
  const people = await listPeople(siteId);
  if (people.length === 0) return <p>Nobody has asked for emails yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th>Email</th>
          <th>Status</th>
          <th>Consented</th>
          <th>Confirmed</th>
          <th>Emails sent</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {people.map((p) => (
          <tr key={p.id} className="border-t align-top">
            <td className="py-1">{p.email}</td>
            <td>{STATUS[p.status]}</td>
            <td>{day(p.consentedAt)}</td>
            <td>{day(p.confirmedAt)}</td>
            <td>{p.sent}</td>
            <td>
              <DeletePersonForm siteId={siteId} email={p.email} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
