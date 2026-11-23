#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/plugin.js" ]]; then
  echo "[Error] plugin.js not found in $SCRIPT_DIR" >&2
  exit 1
fi

if [[ -n "${HERMES_HOME:-}" ]]; then
  TARGET_HOME="$HERMES_HOME"
elif [[ -f "$HOME/.hermes/config.yaml" ]] || [[ -d "$HOME/.hermes" ]]; then
  TARGET_HOME="$HOME/.hermes"
elif [[ -d "${XDG_DATA_HOME:-$HOME/.local/share}/hermes" ]]; then
  TARGET_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/hermes"
else
  TARGET_HOME="$HOME/.hermes"
fi

DEST_DIR="$TARGET_HOME/desktop-plugins/tardis-effort"
mkdir -p "$DEST_DIR"
cp -f "$SCRIPT_DIR/plugin.js" "$DEST_DIR/plugin.js"

echo "[OK] Installed TARDIS Thinking Effort plugin to:"
echo "  $DEST_DIR/plugin.js"
echo ""
echo "If Hermes Desktop is already running:"
echo "  - Wait a few seconds for auto-discovery, or press Cmd/Ctrl+K -> 'Reload desktop plugins'"
echo "  - Configure options under Settings -> Plugins -> TARDIS 推理强度"
