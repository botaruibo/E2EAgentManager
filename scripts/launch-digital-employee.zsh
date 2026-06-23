#!/bin/zsh
set -euo pipefail

APP_DIR="/Users/bytedance/Documents/E2ECommerceAgent"
PORT="4174"
NPM_BIN="/usr/local/bin/npm"
LOG_FILE="$APP_DIR/.tmp/desktop-launcher.log"

mkdir -p "$APP_DIR/.tmp"
cd "$APP_DIR"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  osascript -e 'display notification "数字员工调度中心已经在运行。" with title "数字员工调度中心"' >/dev/null 2>&1 || true
  exit 0
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
nohup "$NPM_BIN" run desktop -- --port "$PORT" --user-data-dir browser-profiles/baiying >> "$LOG_FILE" 2>&1 &
