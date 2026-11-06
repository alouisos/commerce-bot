// Pure helper: no server imports, so it is unit-testable and widget-safe.
export function resolveLanguage(requested: string | null, available: string[], defaultLanguage: string): string {
  const primary = requested?.trim().toLowerCase().split(/[-_]/)[0];
  if (primary && available.includes(primary)) return primary;
  return defaultLanguage;
}
