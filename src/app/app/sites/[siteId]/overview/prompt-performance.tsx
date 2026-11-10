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
    <section className="panel">
      <h3 className="panel-head">Suggestions</h3>
      <div className="panel-body flex flex-col gap-3">
      {proactivity === "off" && (
        <p className="text-sm text-ink-muted">
          Suggestions are off for this website. Turn them on in <Link href={`/app/sites/${siteId}/settings`}>Settings</Link>.
        </p>
      )}
      {paused.map((k) => (
        <p key={k} role="status" className="notice notice-warn">
          <span className="lamp lamp-warn" aria-hidden="true" />
          <span>
          Visitors kept dismissing {PROMPT_KIND_LABELS[k].toLowerCase()}, so the bot has paused them. It will try them
          again in a couple of weeks.
          </span>
        </p>
      ))}
      <div className="table-wrap">
      <table>
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
                <td>{paused.includes(k) ? <span className="badge badge-warn">Paused</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="text-xs text-ink-subtle">
        Counted when a suggestion is shown. Ignored suggestions hide themselves and count as neither.
      </p>
      </div>
    </section>
  );
}
