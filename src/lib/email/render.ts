// Turns a stored email body (plain text with [text](url) links and [[image:ID]] markers) into safe HTML
// and plain text. Everything is escaped; only stored links become (tracked) links.
import { emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { appBaseUrl } from "@/lib/widget/config";

const TOKEN = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)|\[\[image:([A-Za-z0-9-]{1,64})\]\]/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const trackedUrl = (messageId: string, index: number) => `${appBaseUrl()}/e/c/${messageId}/${index}`;

export function renderEmail(input: {
  body: string;
  links: string[];
  messageId: string;
  siteName: string;
  unsubscribeUrl: string;
  imageUrl: (id: string) => string | null;
  language: string;
}): { html: string; text: string } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const paragraphs = input.body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const para of paragraphs) {
    let html = "";
    let text = "";
    let last = 0;
    for (const m of para.matchAll(TOKEN)) {
      const before = para.slice(last, m.index);
      html += escapeHtml(before);
      text += before;
      last = m.index + m[0].length;
      if (m[3] !== undefined) {
        const src = input.imageUrl(m[3]);
        if (src) html += `<img src="${escapeHtml(src)}" alt="" style="max-width:100%;height:auto">`;
        continue;
      }
      const [, label, url] = m;
      const index = input.links.indexOf(url);
      if (index >= 0) {
        const href = trackedUrl(input.messageId, index);
        html += `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
        text += `${label} (${href})`;
      } else {
        html += escapeHtml(label);
        text += label;
      }
    }
    html += escapeHtml(para.slice(last));
    text += para.slice(last);
    const lines = html.split("\n").map((l) => l.trim());
    const content = lines.filter((l, i) => l || i === 0).join("<br>");
    if (content.trim()) htmlParts.push(`<p>${content}</p>`);
    const plain = text
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .trim();
    if (plain) textParts.push(plain);
  }

  const { copy } = emailCopyFor(input.language);
  const footer = fillSite(copy.footer, input.siteName);
  const unsub = escapeHtml(input.unsubscribeUrl);
  htmlParts.push(
    `<p style="font-size:12px;color:#666;margin-top:32px">${escapeHtml(footer)} <a href="${unsub}">${unsub}</a></p>`,
  );
  textParts.push(`--\n${footer} ${input.unsubscribeUrl}`);

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f2937;max-width:560px;margin:0 auto;padding:16px">${htmlParts.join("")}</body></html>`;
  return { html, text: textParts.join("\n\n") };
}
