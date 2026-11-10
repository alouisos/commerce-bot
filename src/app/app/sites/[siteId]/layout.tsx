import Link from "next/link";
import { crawlNotice, pageCounts } from "@/lib/crawl/notice";
import { CrawlBanner } from "./crawl-banner";
import { loadSite } from "./load-site";

export default async function SiteLayout({ children, params }: LayoutProps<"/app/sites/[siteId]">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const counts = (await pageCounts([site.id])).get(site.id)!;
  const notice = crawlNotice(site, counts);
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <p className="text-sm">{site.baseUrl}</p>
      </header>
      <nav aria-label="Website" className="flex gap-4 border-b pb-2">
        <Link href={`/app/sites/${siteId}/settings`}>Settings</Link>
        <Link href={`/app/sites/${siteId}/knowledge`}>Knowledge</Link>
        <Link href={`/app/sites/${siteId}/install`}>Install</Link>
        <Link href={`/app/sites/${siteId}/leads`}>Leads</Link>
      </nav>
      <CrawlBanner siteId={site.id} host={new URL(site.baseUrl).host} notice={notice} />
      {children}
    </div>
  );
}
