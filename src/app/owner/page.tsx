import { and, asc, count, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { accounts, memberships, monthlyUsage, sites, user } from "@/db/schema";
import { isPlatformOwner } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { monthKey } from "@/lib/usage/meter";
import { PlanSelect } from "./plan-select";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function OwnerPage() {
  // Checked here as well as in the layout: a page must not rely on its layout for authorization.
  const currentUser = await requireUser();
  if (!isPlatformOwner(currentUser.email)) notFound();
  const month = monthKey(new Date());
  const [accountRows, ownerRows, siteRows, usageRows] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.createdAt)),
    db
      .select({ accountId: memberships.accountId, email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.role, "owner")),
    db.select({ accountId: sites.accountId, n: count() }).from(sites).groupBy(sites.accountId),
    db.select().from(monthlyUsage).where(and(eq(monthlyUsage.month, month))),
  ]);
  const ownerOf = new Map(ownerRows.map((r) => [r.accountId, r.email]));
  const siteCount = new Map(siteRows.map((r) => [r.accountId, r.n]));
  const usage = new Map(usageRows.map((r) => [r.accountId, r]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owner email</th>
            <th>Plan</th>
            <th>Trial ends</th>
            <th>Sites</th>
            <th>Conversations (month)</th>
            <th>AI cost (month)</th>
            <th>Change plan</th>
          </tr>
        </thead>
        <tbody>
          {accountRows.map((a) => (
            <tr key={a.id} className="border-t">
              <td>{a.name}</td>
              <td>{ownerOf.get(a.id) ?? ""}</td>
              <td>{a.plan}</td>
              <td>{a.trialEndsAt ? a.trialEndsAt.toISOString().slice(0, 10) : ""}</td>
              <td>{siteCount.get(a.id) ?? 0}</td>
              <td>{usage.get(a.id)?.conversations ?? 0}</td>
              <td>{usd.format((usage.get(a.id)?.aiCostMicros ?? 0) / 1e6)}</td>
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
