import { parseMarkdown, type Inline } from "@/shared/markdown";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "strong") return <strong key={i}><Inlines nodes={n.c} /></strong>;
    return (
      <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
        {n.v}
      </a>
    );
  });
}

/** Renders a bot reply's light formatting. React escapes every text node, so markup stays inert. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      {parseMarkdown(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i}><Inlines nodes={b.c} /></p>
        ) : b.t === "ul" ? (
          <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines nodes={it} /></li>)}</ul>
        ) : (
          <ol key={i}>{b.items.map((it, j) => <li key={j}><Inlines nodes={it} /></li>)}</ol>
        ),
      )}
    </div>
  );
}
