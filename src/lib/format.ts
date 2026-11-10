const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "just now" under a minute, otherwise "3 minutes ago" / "2 hours ago" / "4 days ago". */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const s = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

/** The URL if it is http(s), for use as a link target; null for anything else (javascript:, data:, junk). */
export function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "1 conversation", "3 conversations". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Micro-dollars as "$1.50". */
export const usd = (micros: number) => usdFormat.format(micros / 1e6);

/** 3490 EUR → "€34.90". */
export function money(minor: number, currency: string): string {
  const f = new Intl.NumberFormat("en", { style: "currency", currency });
  const decimals = f.resolvedOptions().maximumFractionDigits ?? 2;
  return f.format(minor / 10 ** decimals);
}
