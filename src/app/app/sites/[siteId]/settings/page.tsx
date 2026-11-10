import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, siteGreetings } from "@/db/schema";
import { registrableHost, sendingDomainRecords } from "@/lib/email/domain";
import { planStatus } from "@/lib/plans";
import { loadSite } from "../load-site";
import { DeleteSiteForm } from "./delete-site-form";
import { EmailSettingsForm } from "./email-settings-form";
import { GreetingImageForm } from "./greeting-image-form";
import { SendingDomain } from "./sending-domain";
import { SettingsForm } from "./settings-form";
import { SiteDetailsForm } from "./site-details-form";

export default async function SettingsPage({ params }: PageProps<"/app/sites/[siteId]/settings">) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const rows = await db
    .select()
    .from(siteGreetings)
    .where(eq(siteGreetings.siteId, site.id))
    .orderBy(asc(siteGreetings.language));
  const [account] = await db.select().from(accounts).where(eq(accounts.id, site.accountId));
  const canAutoSend = planStatus(account, new Date()).limits.autoSendEmails;
  const records =
    site.sendingDomainStatus === "pending" || site.sendingDomainStatus === "failed"
      ? await sendingDomainRecords(site)
      : [];
  const byLang = new Map(rows.map((r) => [r.language, r.message]));
  const defaults = ["el", "en"].map((language) => ({ language, message: byLang.get(language) ?? "" }));
  const extra = rows.filter((r) => !["el", "en"].includes(r.language)).map((r) => ({ language: r.language, message: r.message }));

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <SiteDetailsForm siteId={site.id} name={site.name} baseUrl={site.baseUrl} />
      {/* Remount on a URL change: its allowed-origins field is uncontrolled and the origins were re-derived. */}
      <SettingsForm
        key={site.baseUrl}
        siteId={site.id}
        initial={{
          botName: site.botName,
          accentColor: site.accentColor,
          corner: site.corner,
          proactivity: site.proactivity,
          defaultLanguage: site.defaultLanguage,
          guardrails: site.guardrails,
          allowedOrigins: site.allowedOrigins,
          greetings: [...defaults, ...extra],
        }}
      />
      <EmailSettingsForm
        siteId={site.id}
        siteName={site.name}
        canAutoSend={canAutoSend}
        domain={site.sendingDomain}
        initial={{
          emailMode: site.emailMode,
          emailIntervalDays: site.emailIntervalDays,
          emailMaxPerPerson: site.emailMaxPerPerson,
          emailFromName: site.emailFromName ?? "",
          emailFromLocal: site.emailFromLocal,
          retentionMonths: site.retentionMonths,
          consentMode: site.consentMode,
        }}
      />
      <SendingDomain
        siteId={site.id}
        domain={site.sendingDomain}
        status={site.sendingDomainStatus}
        suggested={registrableHost(site.baseUrl)}
        fromLocal={site.emailFromLocal}
        records={records}
      />
      <GreetingImageForm siteId={site.id} hasImage={!!site.greetingImageKey} version={site.greetingImageKey ?? ""} />
      <DeleteSiteForm siteId={site.id} name={site.name} />
    </div>
  );
}
