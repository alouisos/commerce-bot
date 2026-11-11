import Link from "next/link";
import { accounts } from "@/db/schema";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { ownerAiBlocked } from "@/lib/usage/meter";
import { listBuyerQueue, listBuyerSent, listBuyers, listFeedback } from "@/lib/buyers/admin";
import { loadSite } from "../load-site";
import { BuyerDraftEditor } from "./draft-editor";

const TABS = [
  { id: "buyers", label: "Buyers" },
  { id: "queue", label: "Queue" },
  { id: "sent", label: "Sent" },
  { id: "feedback", label: "Feedback" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
const SEQUENCE: Record<string, string> = {
  scheduled: "scheduled",
  draft: "waiting for approval",
  approved: "approved",
  sending: "sending",
  sent: "sent",
  discarded: "discarded",
  failed: "failed",
  skipped: "skipped",
};

export default async function BuyersPage({ params, searchParams }: PageProps<"/app/sites/[siteId]/buyers">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const sp = await searchParams;
  const [account] = await db.select().from(accounts).where(eq(accounts.id, site.accountId));
  const paused = site.buyerEmails !== "off" && !!account && (await ownerAiBlocked(account));
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "buyers";
  const base = `/app/sites/${site.id}/buyers`;
  // Awaited here rather than nested as async components (renderToStaticMarkup can't suspend).
  const body =
    tab === "buyers"
      ? await BuyersList({ siteId: site.id })
      : tab === "queue"
        ? await Queue({ siteId: site.id })
        : tab === "sent"
          ? await Sent({ siteId: site.id, page: Number(sp.page ?? 1), base })
          : await Feedback({ siteId: site.id });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl">Buyers</h2>
      {site.buyerEmails === "off" && (
        <p role="status" className="notice notice-warn">
          <span className="lamp lamp-warn" aria-hidden="true" />
          <span>
            Buyer emails are off. <Link href={`/app/sites/${site.id}/settings`}>Turn them on in Settings</Link>
          </span>
        </p>
      )}
      {paused && <BuyerEmailsPaused />}
      {site.buyerEmails === "automatic" && (
        <p role="status" className="notice notice-info">
          <span className="lamp lamp-live" aria-hidden="true" />
          Buyer emails send automatically. Switch to approval in Settings to review them first.
        </p>
      )}
      <nav aria-label="Buyers" className="tabs">
        {TABS.map((t) => (
          <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

async function BuyersList({ siteId }: { siteId: string }) {
  const rows = await listBuyers(siteId);
  if (rows.length === 0) return <p className="notice">No buyers yet. They appear after the first orders are read from your shop.</p>;
  return (
    <div className="panel table-wrap table-stack">
      <table>
        <thead>
          <tr>
            <th>Buyer</th>
            <th>Orders</th>
            <th>Products</th>
            <th>Emails</th>
            <th>Feedback</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Buyer" className="break-words font-medium">
                {r.email}
                {r.status === "unsubscribed" && <span className="badge ml-2">Unsubscribed</span>}
                {r.status === "suppressed" && <span className="badge ml-2">Suppressed</span>}
              </td>
              <td data-label="Orders">{r.orders}</td>
              <td data-label="Products">{r.products.join(", ") || "—"}</td>
              <td data-label="Emails">
                {r.sequence ? `Email ${r.sequence.step}: ${SEQUENCE[r.sequence.status] ?? r.sequence.status}` : "—"}
              </td>
              <td data-label="Feedback">{r.rating ? `${r.rating} / 5` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Queue({ siteId }: { siteId: string }) {
  const drafts = await listBuyerQueue(siteId);
  if (drafts.length === 0) return <p className="notice">No emails waiting for approval.</p>;
  return (
    <div className="flex flex-col gap-4">
      {drafts.map((d) => (
        <BuyerDraftEditor key={d.id} siteId={siteId} draft={d} />
      ))}
    </div>
  );
}

async function Sent({ siteId, page, base }: { siteId: string; page: number; base: string }) {
  const sent = await listBuyerSent(siteId, page);
  if (sent.total === 0) return <p className="notice">No emails sent yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="panel table-wrap table-stack">
        <table>
          <thead>
            <tr>
              <th>Sent at</th>
              <th>To</th>
              <th>Email</th>
              <th>Subject</th>
              <th>Clicks</th>
            </tr>
          </thead>
          <tbody>
            {sent.rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Sent at" className="whitespace-nowrap tabular-nums text-ink-muted">
                  {when(r.sentAt)}
                </td>
                <td data-label="To" className="break-words">{r.email}</td>
                <td data-label="Email">{r.step}</td>
                <td data-label="Subject">{r.subject}</td>
                <td data-label="Clicks">{r.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

async function Feedback({ siteId }: { siteId: string }) {
  const rows = await listFeedback(siteId);
  if (rows.length === 0) return <p className="notice">No feedback yet.</p>;
  return (
    <div className="panel table-wrap table-stack">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Buyer</th>
            <th>Rating</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Date" className="whitespace-nowrap tabular-nums text-ink-muted">
                {when(r.createdAt)}
              </td>
              <td data-label="Buyer" className="break-words">{r.email}</td>
              <td data-label="Rating">{r.rating} / 5</td>
              {/* Written by the buyer: rendered as text only. */}
              <td data-label="Comment" className="break-words whitespace-pre-wrap">{r.comment || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyerEmailsPaused() {
  return (
    <p role="status" className="notice notice-warn">
      <span className="lamp lamp-warn" aria-hidden="true" />
      <span>Buyer emails are paused until next month: this month&apos;s owner AI budget is used up.</span>
    </p>
  );
}
