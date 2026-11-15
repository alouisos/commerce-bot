import { useEffect, useState } from "preact/hooks";

/** Phones: the chat is a bottom sheet over the page instead of a floating panel. */
export const NARROW_QUERY = "(max-width: 479px)";

/** The sheet's heights: a bar, about half the screen with the page usable above it, or the whole screen. */
export type Sheet = "mini" | "peek" | "full";

export function isNarrow(win: Window = window): boolean {
  try {
    return win.matchMedia?.(NARROW_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** Follows the narrow-screen query (a phone turned sideways, a resized window). */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => isNarrow());
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try {
      mq = window.matchMedia?.(NARROW_QUERY);
    } catch {
      return;
    }
    if (!mq || typeof mq.addEventListener !== "function") return;
    const list = mq;
    const onChange = () => setNarrow(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function growSheet(s: Sheet): Sheet {
  return s === "mini" ? "peek" : "full";
}

export function shrinkSheet(s: Sheet): Sheet {
  return s === "full" ? "peek" : "mini";
}

/**
 * The on-screen keyboard and the visible area, while `active`. Fixed elements sit in the layout viewport, which
 * the keyboard doesn't shrink on every browser: the sheet stands on `kb` and is at most `height` tall.
 */
export function useVisualViewport(active: boolean): { kb: number; height: number } | null {
  const [vv, setVv] = useState<{ kb: number; height: number } | null>(null);
  useEffect(() => {
    const v = active ? window.visualViewport : null;
    if (!v) {
      setVv(null);
      return;
    }
    const update = () =>
      setVv({ kb: Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)), height: Math.round(v.height) });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, [active]);
  return vv;
}

/** One line of plain text for the minimized bar: no markdown, links or image markers. */
export function previewText(markdown: string): string {
  return markdown
    .replace(/\[\[image:[^\]]*\]\]/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
