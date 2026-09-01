#!/usr/bin/env bash
# install-launchd.sh — install the Mon/Thu local context-maintenance launchd job (macOS).
# Idempotent: re-run to update. Uninstall with:
#   launchctl bootout gui/$(id -u)/com.example.context-maintenance
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CONTEXT_REPO:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)}"
LABEL="com.example.context-maintenance"
SRC="$SCRIPT_DIR/com.example.context-maintenance.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed -e "s#REPLACE_WITH_REPO_PATH#$REPO#g" \
    -e "s#REPLACE_WITH_HOME#$HOME#g" \
    "$SRC" > "$DEST"

# reload
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed $LABEL (Mon + Thu 05:10 local)."
echo "  Run now:   launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "  Logs:      ~/Library/Logs/context-maintenance.{out,err}.log"
echo "  Uninstall: launchctl bootout gui/$(id -u)/$LABEL"
