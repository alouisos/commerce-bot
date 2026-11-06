import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites } from "@/db/schema";
import { getAccountForUser } from "@/lib/accounts";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { AddSiteForm } from "./add-site-form";

export default async function WebsitesPage() {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  const list = await db.select().from(sites).where(eq(sites.accountId, account.id)).orderBy(desc(sites.createdAt));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">Your websites</h1>
        {list.length === 0 ? (
          <p>You have no websites yet. Add one below.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((s) => (
              <li key={s.id} className="border p-3">
                <Link href={`/app/sites/${s.id}/settings`} className="font-medium underline">
                  {s.name}
                </Link>
                <div>{s.baseUrl}</div>
                <div className="text-sm">
                  Crawl status: {s.crawlStatus} · Last seen on site:{" "}
                  {s.lastSeenAt ? relativeTime(s.lastSeenAt) : "Not installed yet"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddSiteForm />
    </div>
  );
}
