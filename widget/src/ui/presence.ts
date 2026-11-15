import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** How long an element stays on screen after it goes away, for its exit animation (see styles.css). */
export const EXIT_MS = 200;

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Keeps the last non-null value on screen for EXIT_MS after it becomes null, flagged `leaving`, so it can
 * animate out. A value that comes back while leaving shows again at once. No delay with reduced motion.
 */
export function usePresence<T>(value: T | null): { shown: T | null; leaving: boolean } {
  const lastRef = useRef<T | null>(null);
  const [leavingValue, setLeavingValue] = useState<{ v: T } | null>(null);
  const present = value !== null;

  // Remembers the value of the last render that had one, to keep showing it once it goes away.
  useLayoutEffect(() => {
    if (value !== null) lastRef.current = value;
  });

  // Layout effect so the exit timer starts in the same frame the value went away.
  useLayoutEffect(() => {
    if (present) {
      setLeavingValue(null);
      return;
    }
    const last = lastRef.current;
    lastRef.current = null;
    if (last === null || reducedMotion()) return;
    setLeavingValue({ v: last });
    const t = setTimeout(() => setLeavingValue(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [present]);

  if (present) return { shown: value, leaving: false };
  return leavingValue ? { shown: leavingValue.v, leaving: true } : { shown: null, leaving: false };
}
