export type QuotaState = "ok" | "warning" | "limit" | "ceiling";

export function quotaState(used: number, limit: number): QuotaState {
  if (limit <= 0) return "ceiling";
  const ratio = used / limit;
  if (ratio >= 1.5) return "ceiling";
  if (ratio >= 1) return "limit";
  if (ratio >= 0.8) return "warning";
  return "ok";
}
