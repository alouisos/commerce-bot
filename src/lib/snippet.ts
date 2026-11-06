export function buildSnippet(appUrl: string, publicKey: string): string {
  return `<script src="${appUrl}/widget.js" data-site="${publicKey}" async></script>`;
}
