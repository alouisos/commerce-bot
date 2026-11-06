import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { siteGreetings } from "@/db/schema";
import { loadSite } from "../load-site";
import { DeleteSiteForm } from "./delete-site-form";
import { GreetingImageForm } from "./greeting-image-form";
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
          defaultLanguage: site.defaultLanguage,
          guardrails: site.guardrails,
          allowedOrigins: site.allowedOrigins,
          greetings: [...defaults, ...extra],
        }}
      />
      <GreetingImageForm siteId={site.id} hasImage={!!site.greetingImageKey} version={site.greetingImageKey ?? ""} />
      <DeleteSiteForm siteId={site.id} name={site.name} />
    </div>
  );
}
