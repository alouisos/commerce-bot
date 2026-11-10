/** "34.90" EUR → 3490. Parsed from the string (never through floats); null when it isn't a plain amount. */
export function toMinorUnits(total: string | null, currency: string): number | null {
  if (total === null || !/^\d+(\.\d+)?$/.test(total)) return null;
  let decimals: number;
  try {
    decimals = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return null;
  }
  const [whole, frac = ""] = total.split(".");
  const padded = frac.padEnd(decimals + 1, "0");
  let minor = Number(whole) * 10 ** decimals + Number(padded.slice(0, decimals) || "0");
  if (Number(padded[decimals]) >= 5) minor += 1; // half up on the first dropped digit
  return Number.isSafeInteger(minor) ? minor : null;
}
