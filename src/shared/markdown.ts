// Parses the small markdown subset the bot replies in (bold, links, bullet/numbered lists) into a
// plain tree. Mirrors widget/src/render.ts; never produces HTML, so markup in a reply stays text.
export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "link"; href: string; v: string };
export type Block = { t: "p"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

const INLINE_SRC = /\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const UL = /^\s*[-*] +(.*)$/;
const OL = /^\s*\d+\. +(.*)$/;

function safeHref(raw: string): boolean {
  try {
    const p = new URL(raw).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

function inline(text: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  const push = (v: string) => {
    if (v) out.push({ t: "text", v });
  };
  let last = 0;
  const re = new RegExp(INLINE_SRC.source, "g"); // per call: inline() recurses
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      if (allowBold) out.push({ t: "strong", c: inline(m[1], false) });
      else push(m[0]);
    } else if (safeHref(m[3])) {
      out.push({ t: "link", href: m[3], v: m[2] });
    } else {
      push(m[2]);
    }
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

type Kind = "text" | "ul" | "ol";

function lineKind(line: string): { kind: Kind; body: string } {
  let m = UL.exec(line);
  if (m) return { kind: "ul", body: m[1] };
  m = OL.exec(line);
  if (m) return { kind: "ol", body: m[1] };
  return { kind: "text", body: line };
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    if (!chunk.trim()) continue;
    const runs: { kind: Kind; lines: string[] }[] = [];
    for (const line of chunk.split("\n")) {
      const { kind, body } = lineKind(line);
      const prev = runs[runs.length - 1];
      if (prev && prev.kind === kind) prev.lines.push(body);
      else runs.push({ kind, lines: [body] });
    }
    for (const run of runs) {
      if (run.kind === "text") {
        // Line breaks stay as "\n" inside the text; the stylesheet renders them (pre-line).
        const c: Inline[] = [];
        run.lines.forEach((l, i) => {
          if (i > 0) c.push({ t: "text", v: "\n" });
          c.push(...inline(l));
        });
        blocks.push({ t: "p", c });
      } else {
        blocks.push({ t: run.kind, items: run.lines.map((l) => inline(l)) });
      }
    }
  }
  return blocks;
}
