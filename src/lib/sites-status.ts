/** A website counts as Live when its widget loaded on the site within this window. */
export const LIVE_WINDOW_MS = 7 * 86_400_000;

export function isLive(lastSeenAt: Date | null, now: Date): boolean {
  return lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= LIVE_WINDOW_MS;
}
