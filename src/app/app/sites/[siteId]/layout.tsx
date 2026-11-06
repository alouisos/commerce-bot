import Link from "next/link";
import { loadSite } from "./load-site";

export default async function SiteLayout({ children, params }: LayoutProps<"/app/sites/[siteId]">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
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
      </nav>
      {children}
    </div>
  );
}
