import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { accounts, memberships, monthlyUsage, user } from "@/db/schema";
import { RangePicker } from "@/components/RangePicker";
import { StatTile } from "@/components/StatTile";
import { isPlatformOwner } from "@/lib/access";
import { usd } from "@/lib/format";
import { getAccountStats, getPlatformTotals } from "@/lib/stats/platform";
import { parseRange } from "@/lib/stats/range";
import { requireUser } from "@/lib/session";
import { monthKey } from "@/lib/usage/meter";
import { listPendingInvites } from "@/lib/invites";
import { cancelInviteAction, resendInviteAction } from "./actions";
import { InviteForm } from "./invite-form";
import { PlanSelect } from "./plan-select";

type Search = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function OwnerPage({ searchParams }: Search = {}) {
  // Checked here as well as in the layout: a page must not rely on its layout for authorization.
  const currentUser = await requireUser();
  if (!isPlatformOwner(currentUser)) notFound();
  const range = parseRange((await searchParams)?.range);
  const [accountRows, ownerRows, stats, total, monthRows, invites] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.createdAt)),
    db
      .select({ accountId: memberships.accountId, email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.role, "owner")),
    getAccountStats(range),
    getPlatformTotals(range),
    db.select().from(monthlyUsage).where(eq(monthlyUsage.month, monthKey(new Date()))),
    listPendingInvites(),
  ]);
  const month = new Map(monthRows.map((r) => [r.accountId, r]));
  const ownerOf = new Map(ownerRows.map((r) => [r.accountId, r.email]));
  const statsOf = new Map(stats.map((s) => [s.accountId, s]));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Platform · {range.label}</h1>
        <RangePicker basePath="/owner" current={range.key} />
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatTile label="Accounts" value={String(total.accounts)} />
        <StatTile label="Sites" value={String(total.sites)} />
        <StatTile label="Conversations" value={String(total.conversations)} />
        <StatTile label="Emails captured" value={String(total.emailsCaptured)} />
        <StatTile label="Unanswered" value={String(total.unanswered)} />
        <StatTile label="AI cost" value={usd(total.aiCostMicros)} />
      </dl>
      <InviteForm />
      {invites.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Pending invites</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Email</th>
                <th>Account</th>
                <th>Plan</th>
                <th>Sent</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-1">{i.email}</td>
                  <td>{i.accountName}</td>
                  <td>{i.plan}</td>
                  <td>{i.createdAt.toISOString().slice(0, 10)}</td>
                  <td>{i.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="flex gap-2">
                    <form action={resendInviteAction.bind(null, i.id)}>
                      <button type="submit" className="underline">
                        Resend
                      </button>
                    </form>
                    <form action={cancelInviteAction.bind(null, i.id)}>
                      <button type="submit" className="underline">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <h2 className="text-lg font-semibold">Accounts</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owner email</th>
            <th>Plan</th>
            <th>Trial ends</th>
            <th>Sites</th>
            <th>Conversations</th>
            <th>Emails</th>
            <th>Unanswered</th>
            <th>AI cost</th>
            <th>Conversations (month)</th>
            <th>AI cost (month)</th>
            <th>Change plan</th>
          </tr>
        </thead>
        <tbody>
          {accountRows.map((a) => (
            <tr key={a.id} className="border-t">
              <td>
                <Link href={`/owner/accounts/${a.id}?range=${range.key}`} className="underline">
                  {a.name}
                </Link>
              </td>
              <td>{ownerOf.get(a.id) ?? ""}</td>
              <td>{a.plan}</td>
              <td>{a.trialEndsAt ? a.trialEndsAt.toISOString().slice(0, 10) : ""}</td>
              <td>{statsOf.get(a.id)?.sites ?? 0}</td>
              <td>{statsOf.get(a.id)?.conversations ?? 0}</td>
              <td>{statsOf.get(a.id)?.emailsCaptured ?? 0}</td>
              <td>{statsOf.get(a.id)?.unanswered ?? 0}</td>
              <td>{usd(statsOf.get(a.id)?.aiCostMicros ?? 0)}</td>
              <td>{month.get(a.id)?.conversations ?? 0}</td>
              <td>{usd(month.get(a.id)?.aiCostMicros ?? 0)}</td>
              <td>
                <PlanSelect accountId={a.id} plan={a.plan} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
