// Pure helpers: image markers the model writes as [[image:ID]].

const MARKER = /\[\[image:([^\]]*)\]\]/g;
const MARKER_PREFIX = "[[image:";
const HOLD_MAX = 60;

/** Removes every [[image:…]] marker; returns allowed ids in order, deduped, and tidies the blank lines left behind. */
export function extractImageMarkers(text: string, allowed: Set<string>): { text: string; imageIds: string[] } {
  const imageIds: string[] = [];
  const stripped = text.replace(MARKER, (_m, raw: string) => {
    const id = raw.trim();
    if (allowed.has(id) && !imageIds.includes(id)) imageIds.push(id);
    return "";
  });
  if (stripped === text) return { text, imageIds };
  const tidy = stripped
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: tidy, imageIds };
}

/**
 * Streaming filter that hides image markers from live deltas. Text from a
 * possible marker start is held back until `]]` closes it (the marker is
 * dropped) or it can no longer be a marker, or it grows to 60 chars, or the
 * stream ends (then it is released as plain text).
 */
export function createMarkerFilter(): { push(chunk: string): string; flush(): string } {
  let held = "";

  function drain(input: string): string {
    let out = "";
    let rest = input;
    while (rest) {
      if (!held) {
        const at = rest.indexOf("[");
        if (at === -1) return out + rest;
        out += rest.slice(0, at);
        rest = rest.slice(at);
      }
      // Holding: `held + rest` starts with "[".
      const buf = held + rest;
      held = "";
      rest = "";
      if (buf.startsWith(MARKER_PREFIX)) {
        const close = buf.indexOf("]]");
        if (close !== -1 && close < HOLD_MAX) {
          rest = buf.slice(close + 2); // marker dropped
          continue;
        }
        if (buf.length < HOLD_MAX) {
          held = buf;
          continue;
        }
        out += buf.slice(0, 1); // too long: release the "[" as text and rescan the rest
        rest = buf.slice(1);
        continue;
      }
      if (MARKER_PREFIX.startsWith(buf)) {
        held = buf; // could still become a marker
        continue;
      }
      out += buf.slice(0, 1);
      rest = buf.slice(1);
    }
    return out;
  }

  return {
    push: (chunk) => drain(chunk),
    flush: () => {
      const out = held;
      held = "";
      return out;
    },
  };
}
