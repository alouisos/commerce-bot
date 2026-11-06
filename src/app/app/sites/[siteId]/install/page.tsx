import { CopyBlock } from "@/components/CopyButton";
import { env } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { buildSnippet } from "@/lib/snippet";
import { loadSite } from "../load-site";

export default async function InstallPage({ params }: PageProps<"/app/sites/[siteId]/install">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const snippet = buildSnippet(env.APP_URL.replace(/\/+$/, ""), site.publicKey);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your install snippet</h2>
        <CopyBlock text={snippet} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Any website</h2>
        <p>
          Paste the snippet into your site&apos;s HTML just before the closing <code>&lt;/body&gt;</code> tag, then
          publish the change.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">WordPress</h2>
        <ol className="list-decimal pl-6">
          <li>Install the free WPCode plugin.</li>
          <li>Go to Code Snippets, then Header &amp; Footer.</li>
          <li>Paste the snippet into the Footer box.</li>
          <li>Click Save.</li>
        </ol>
        <p>Alternatively, paste the snippet into your theme&apos;s footer.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Check it&apos;s working</h2>
        <p>{site.lastSeenAt ? `Seen on your site ${relativeTime(site.lastSeenAt)}` : "Not detected yet"}</p>
      </section>
    </div>
  );
}
