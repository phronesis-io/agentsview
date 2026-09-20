#!/usr/bin/env bash
# Build this fork and install it for the current user:
#   - binary            -> $BIN_DIR/agentsview (default ~/.local/bin)
#   - macOS launchd job -> imports new sessions every 60s and keeps the
#                          local web UI (http://127.0.0.1:8080) running
# Re-run it any time to upgrade after `git pull`.
#
# Env knobs: BIN_DIR=<dir>  NO_SERVICE=1 (build + copy only)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# If an official agentsview is already installed, replace it in place (keeping
# a backup) so there is only ever one agentsview on PATH.
EXISTING="$(command -v agentsview 2>/dev/null || true)"
if [ -z "${BIN_DIR:-}" ] && [ -n "$EXISTING" ] && [ -w "$(dirname "$EXISTING")" ]; then
  BIN_DIR="$(dirname "$EXISTING")"
fi
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
LABEL="io.phronesis.agentsview.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

for tool in go npm make; do
  command -v "$tool" >/dev/null || {
    echo "缺少 $tool。macOS: brew install go node && xcode-select --install" >&2
    exit 1
  }
done

echo "==> 编译(首次约 3-5 分钟,要下载依赖)"
make -C "$REPO" build

echo "==> 安装到 $BIN_DIR/agentsview"
mkdir -p "$BIN_DIR"
if [ -x "$BIN_DIR/agentsview" ] && [ -z "${NO_SERVICE:-}" ]; then
  "$BIN_DIR/agentsview" serve stop >/dev/null 2>&1 || true
  if [ ! -e "$BIN_DIR/agentsview.before-phronesis" ]; then
    cp "$BIN_DIR/agentsview" "$BIN_DIR/agentsview.before-phronesis"
    echo "    原有版本已备份为 $BIN_DIR/agentsview.before-phronesis"
  fi
fi
install -m 0755 "$REPO/agentsview" "$BIN_DIR/agentsview"
"$BIN_DIR/agentsview" --version

OTHER="$(command -v agentsview 2>/dev/null || true)"
if [ -n "$OTHER" ] && [ "$OTHER" != "$BIN_DIR/agentsview" ]; then
  echo "注意: PATH 里排在前面的是另一份 $OTHER(这次没替换它)。" >&2
  echo "      请删掉它或用新版覆盖它,否则命令行敲 agentsview 用的还是旧版。" >&2
fi

if [ -n "${NO_SERVICE:-}" ]; then
  echo "NO_SERVICE=1: 跳过后台任务。手动启动: $BIN_DIR/agentsview serve"
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "非 macOS: 未安装后台任务。请自行常驻 '$BIN_DIR/agentsview serve',"
  echo "并用 cron/systemd 每分钟跑一次 '$BIN_DIR/agentsview sync'。"
  exit 0
fi

echo "==> 安装 launchd 后台任务 $LABEL"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$BIN_DIR/agentsview</string><string>sync</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>/tmp/agentsview-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/agentsview-sync.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

echo "==> 全量导入本机会话(会话多的话约 1-2 分钟)"
"$BIN_DIR/agentsview" sync --full | tail -3

launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "装好了。打开 http://127.0.0.1:8080"
echo "后台日志: /tmp/agentsview-sync.log    卸载: $REPO/phronesis/uninstall.sh"
