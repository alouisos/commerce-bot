// Renders model output as DOM nodes. Never uses innerHTML: every piece of text goes through
// createTextNode/textContent, so markup in a reply stays inert.
import type { WidgetImage } from "../../src/shared/widget-protocol";

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

function inline(doc: Document, text: string, parent: Node, allowBold = true): void {
  let last = 0;
  const re = new RegExp(INLINE_SRC.source, "g"); // per call: inline() recurses
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.appendChild(doc.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      if (allowBold) {
        const b = doc.createElement("strong");
        inline(doc, m[1], b, false);
        parent.appendChild(b);
      } else {
        parent.appendChild(doc.createTextNode(m[0]));
      }
    } else if (safeHref(m[3])) {
      const a = doc.createElement("a");
      a.setAttribute("href", m[3]);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.textContent = m[2];
      parent.appendChild(a);
    } else {
      parent.appendChild(doc.createTextNode(m[2]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(doc.createTextNode(text.slice(last)));
}

type Kind = "text" | "ul" | "ol";

function lineKind(line: string): { kind: Kind; body: string } {
  let m = UL.exec(line);
  if (m) return { kind: "ul", body: m[1] };
  m = OL.exec(line);
  if (m) return { kind: "ol", body: m[1] };
  return { kind: "text", body: line };
}

function renderBlock(doc: Document, block: string, out: DocumentFragment): void {
  const runs: { kind: Kind; lines: string[] }[] = [];
  for (const line of block.split("\n")) {
    const { kind, body } = lineKind(line);
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind) prev.lines.push(body);
    else runs.push({ kind, lines: [body] });
  }
  for (const run of runs) {
    if (run.kind === "text") {
      const p = doc.createElement("p");
      run.lines.forEach((l, i) => {
        if (i > 0) p.appendChild(doc.createElement("br"));
        inline(doc, l, p);
      });
      out.appendChild(p);
    } else {
      const list = doc.createElement(run.kind);
      for (const l of run.lines) {
        const li = doc.createElement("li");
        inline(doc, l, li);
        list.appendChild(li);
      }
      out.appendChild(list);
    }
  }
}

/** `apiBase` is required to show images: only URLs under it are rendered. */
export function renderMessage(
  doc: Document,
  text: string,
  images: WidgetImage[],
  apiBase?: string,
): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    if (block.trim()) renderBlock(doc, block, frag);
  }
  if (apiBase) {
    const prefix = `${apiBase.replace(/\/+$/, "")}/`;
    const ok = images.filter((i) => i.url.startsWith(prefix));
    if (ok.length) {
      const wrap = doc.createElement("div");
      wrap.className = "images";
      for (const i of ok) {
        const img = doc.createElement("img");
        img.setAttribute("src", i.url);
        img.setAttribute("alt", i.caption);
        img.setAttribute("loading", "lazy");
        wrap.appendChild(img);
      }
      frag.appendChild(wrap);
    }
  }
  return frag;
}
