import Link from "next/link";
import { RANGE_KEYS, type RangeKey } from "@/lib/stats/range";

const LABELS: Record<RangeKey, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

/** Links for the date-range presets. Keeps the page's other search params, except the page number. */
export function RangePicker({
  basePath,
  current,
  params = {},
}: {
  basePath: string;
  current: RangeKey;
  params?: Record<string, string | undefined>;
}) {
  const href = (key: RangeKey) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "range" && k !== "page") q.set(k, v);
    q.set("range", key);
    return `${basePath}?${q}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
    <nav aria-label="Date range" className="seg">
      {RANGE_KEYS.map((key) => (
        <Link
          key={key}
          href={href(key)}
          aria-current={key === current ? "page" : undefined}
        >
          {LABELS[key]}
        </Link>
      ))}
    </nav>
      <span className="text-xs text-ink-subtle">Days in UTC</span>
    </div>
  );
}
