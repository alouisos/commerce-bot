import { crawlNotice, pageCounts } from "@/lib/crawl/notice";
import { CrawlBanner } from "./crawl-banner";
import { loadSite } from "./load-site";

// The website's sections live in the main sign stack (components/SignStack.tsx).
export default async function SiteLayout({ children, params }: LayoutProps<"/app/sites/[siteId]">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const counts = (await pageCounts([site.id])).get(site.id)!;
  const notice = crawlNotice(site, counts);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">{site.name}</h1>
        <p className="page-sub">{site.baseUrl}</p>
      </header>
      <CrawlBanner siteId={site.id} host={new URL(site.baseUrl).host} notice={notice} />
      {children}
    </div>
  );
}
