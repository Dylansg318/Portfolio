#!/usr/bin/env bash
# Regenerate public/resume.pdf from the built /resume page.
#
# The PDF is a print of the page, not a second document, so the two cannot
# drift. Run this after any change to src/lib/site.ts or src/pages/resume.astro,
# check the page count it reports, and commit the PDF with the change.
#
# Requires: a `dist/` from `npm run build` (pass --build to run it first),
# Google Chrome, and poppler's `pdfinfo`/`pdftotext` (brew install poppler)
# for the checks. Chrome prints the page in light mode with the @media print
# rules from src/styles/global.css.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=4399
OUT=public/resume.pdf
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [[ "${1:-}" == "--build" ]]; then npm run build; fi
[[ -d dist/client ]] || { echo "no dist/client — run 'npm run build' or pass --build" >&2; exit 1; }
[[ -x "$CHROME" ]] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }

# Serve the static build. `build.format: 'file'` means the page is /resume.html.
python3 -m http.server "$PORT" -d dist/client >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -sf -o /dev/null "http://localhost:$PORT/resume.html" && break
  sleep 0.1
done

# --virtual-time-budget lets the self-hosted fonts finish loading before the
# print, otherwise the first run ships fallback glyphs and different line
# breaks than the second.
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --no-pdf-header-footer --virtual-time-budget=4000 \
  --print-to-pdf="$OUT" "http://localhost:$PORT/resume.html" 2>/dev/null

if command -v pdfinfo >/dev/null; then
  PAGES=$(pdfinfo "$OUT" | awk '/^Pages:/ {print $2}')
  echo "wrote $OUT — $PAGES page(s)"
  [[ "$PAGES" == "1" ]] || { echo "résumé runs to $PAGES pages; tighten copy or print CSS" >&2; exit 2; }
else
  echo "wrote $OUT (install poppler to verify the page count)"
fi
# A PDF an ATS can read is one whose text survives extraction.
if command -v pdftotext >/dev/null; then
  pdftotext "$OUT" - | grep -qi "experience" || { echo "text extraction failed — PDF is not parseable" >&2; exit 3; }
fi
