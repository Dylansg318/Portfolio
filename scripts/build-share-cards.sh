#!/usr/bin/env bash
# Regenerate the /play social cards from their composers in scripts/share-cards/.
#
# A demo's share card is the one image that decides whether a link someone
# pasted into a group chat gets opened. It is a build artefact, not a hand-made
# file: the composer beside it is plain HTML that reuses the game's own colours,
# faces and cover capture, so the card cannot drift away from the game.
#
# Run this after changing a composer or a cover, then commit the PNG with it.
# Requires Google Chrome (set CHROME=... if it is somewhere unusual).
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[[ -x "$CHROME" ]] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }

# 1200x630 is the shape every unfurler crops to. Captured at 2x so the served
# card is resampled down rather than up — Astro emits the 1200px version.
W=1200
H=630

render() {
  local name="$1" out="$2"
  local src="scripts/share-cards/${name}.html"
  [[ -f "$src" ]] || { echo "no composer at $src" >&2; exit 1; }

  # --virtual-time-budget lets the cover image decode before the capture;
  # without it the first run screenshots the scrim over an empty box.
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$W,$H" --virtual-time-budget=4000 \
    --screenshot="$out" "file://$PWD/$src" 2>/dev/null

  [[ -s "$out" ]] || { echo "chrome wrote nothing to $out" >&2; exit 2; }
  echo "wrote $out — $(sips -g pixelWidth -g pixelHeight "$out" | awk '/pixel/ {printf "%s ", $2}')"
}

render shotcall src/content/projects/shotcall/share.png
