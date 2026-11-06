#!/usr/bin/env bash
# Regenerates sample.md, sample.pdf, sample.docx. Requires LibreOffice (soffice) and Noto fonts with Greek glyphs.
set -euo pipefail
cd "$(dirname "$0")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > sample.md <<'TXT'
# Argan oil care guide

Argan oil protects colour-treated hair.

Το λάδι αργκάν προστατεύει τα βαμμένα μαλλιά.
TXT
cp sample.md "$tmp/sample.txt"
HOME="$tmp" soffice --headless --convert-to pdf --outdir "$tmp" "$tmp/sample.txt" >/dev/null
HOME="$tmp" soffice --headless --convert-to docx:"MS Word 2007 XML" --outdir "$tmp" "$tmp/sample.txt" >/dev/null
cp "$tmp/sample.pdf" "$tmp/sample.docx" .
