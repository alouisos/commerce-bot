import { CopyBlock } from "@/components/CopyButton";
import { env } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { buildSnippet } from "@/lib/snippet";
import { testModeKey } from "@/lib/widget/test-mode";
import { loadSite } from "../load-site";

export default async function InstallPage({ params }: PageProps<"/app/sites/[siteId]/install">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const snippet = buildSnippet(env.APP_URL.replace(/\/+$/, ""), site.publicKey);
  // Only members of the site's account reach this page (loadSite), so only they see the key.
  const testUrl = `${site.baseUrl}#concierge-test=${testModeKey(site.publicKey)}`;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <section className="panel">
        <h2 className="panel-head">Your install snippet</h2>
        <div className="panel-body">
          <CopyBlock text={snippet} />
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-head">Any website</h2>
        <p className="panel-body">
          Paste the snippet into your site&apos;s HTML just before the closing <code>&lt;/body&gt;</code> tag, then
          publish the change.
        </p>
      </section>
      <section className="panel">
        <h2 className="panel-head">WordPress</h2>
        <div className="panel-body flex flex-col gap-3">
        <ol className="flex list-decimal flex-col gap-1 pl-6 marker:text-sodium">
          <li>Install the free WPCode plugin.</li>
          <li>Go to Code Snippets, then Header &amp; Footer.</li>
          <li>Paste the snippet into the Footer box.</li>
          <li>Click Save.</li>
        </ol>
        <p className="text-ink-muted">Alternatively, paste the snippet into your theme&apos;s footer.</p>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-head">Test the bot on your site</h2>
        <div className="panel-body flex flex-col items-start gap-3">
          <p>
            Opens your website with the bot in test mode in that tab only: greeting on every page, suggestions after 3
            seconds with no limit, and the email ask after the first reply. Test chats are marked Test and left out of
            your numbers.
          </p>
          <a href={testUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            Open your site in test mode
          </a>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-head">Check it&apos;s working</h2>
        <p className="panel-body flex items-center gap-3">
          <span className={site.lastSeenAt ? "lamp lamp-ok" : "lamp"} aria-hidden="true" />
          {site.lastSeenAt ? `Seen on your site ${relativeTime(site.lastSeenAt)}` : "Not detected yet"}
        </p>
      </section>
    </div>
  );
}
