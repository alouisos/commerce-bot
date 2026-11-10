export type RangeKey = "7d" | "30d" | "90d";

export type StatsRange = { key: RangeKey; days: number; from: Date; to: Date; label: string };

const DAYS: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90 };
export const RANGE_KEYS = Object.keys(DAYS) as RangeKey[];
const DAY_MS = 24 * 60 * 60 * 1000;

function isRangeKey(v: string | undefined): v is RangeKey {
  return v !== undefined && Object.hasOwn(DAYS, v);
}

/** A `?range=` value as a range of UTC days ending now: today plus the N−1 previous days. Defaults to 30 days. */
export function parseRange(value: string | string[] | undefined, now: Date = new Date()): StatsRange {
  const raw = Array.isArray(value) ? value[0] : value;
  const key: RangeKey = isRangeKey(raw) ? raw : "30d";
  const days = DAYS[key];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { key, days, from: new Date(today - (days - 1) * DAY_MS), to: now, label: `Last ${days} days` };
}

/** `YYYY-MM-DD` for each UTC day in the range, oldest first. */
export function dayKeys(range: StatsRange): string[] {
  return Array.from({ length: range.days }, (_, i) =>
    new Date(range.from.getTime() + i * DAY_MS).toISOString().slice(0, 10),
  );
}
