#!/usr/bin/env bash
# Remove the background job and the binary. Session archive (~/.agentsview)
# is kept; delete it yourself if you want a clean slate.
set -uo pipefail
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
LABEL="io.phronesis.agentsview.sync"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
[ -x "$BIN_DIR/agentsview" ] && "$BIN_DIR/agentsview" serve stop >/dev/null 2>&1
rm -f "$BIN_DIR/agentsview"
echo "已卸载。会话库仍在 ~/.agentsview(不需要可手动删除)。"
