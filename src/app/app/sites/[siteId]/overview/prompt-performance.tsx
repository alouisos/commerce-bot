import Link from "next/link";
import { pausedKinds, promptStats } from "@/lib/prompts/backoff";
import type { StatsRange } from "@/lib/stats/range";
import type { Proactivity, PromptKind } from "@/shared/widget-protocol";

export const PROMPT_KIND_LABELS: Record<PromptKind, string> = {
  question: "Questions about the page",
  pairing: "Pairing suggestions",
};

const rate = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "–");

/** How the bot's suggestions do on this site. Callers must have checked access to the site. */
export async function PromptPerformance({
  siteId,
  proactivity,
  range,
}: {
  siteId: string;
  proactivity: Proactivity;
  range: StatsRange;
}) {
  const [stats, paused] = await Promise.all([promptStats(siteId, range), pausedKinds(siteId)]);
  const kinds = Object.keys(PROMPT_KIND_LABELS) as PromptKind[];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-semibold">Suggestions</h3>
      {proactivity === "off" && (
        <p className="text-sm">
          Suggestions are off for this website. Turn them on in{" "}
          <Link href={`/app/sites/${siteId}/settings`} className="underline">
            Settings
          </Link>
          .
        </p>
      )}
      {paused.map((k) => (
        <p key={k} role="status" className="border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          Visitors kept dismissing {PROMPT_KIND_LABELS[k].toLowerCase()}, so the bot has paused them. It will try them
          again in a couple of weeks.
        </p>
      ))}
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>Type</th>
            <th>Shown</th>
            <th>Tapped</th>
            <th>Dismissed</th>
            <th>Tap rate</th>
            <th>Dismiss rate</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((k) => {
            const s = stats[k];
            return (
              <tr key={k} className="border-t">
                <td>{PROMPT_KIND_LABELS[k]}</td>
                <td>{s.shown}</td>
                <td>{s.tapped}</td>
                <td>{s.dismissed}</td>
                <td>{rate(s.tapped, s.shown)}</td>
                <td>{rate(s.dismissed, s.shown)}</td>
                <td>{paused.includes(k) ? "Paused" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs opacity-70">
        Counted when a suggestion is shown. Ignored suggestions hide themselves and count as neither.
      </p>
    </section>
  );
}
