#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://localhost:${PORT:-3000}"

# 1. Đảm bảo Bridge Server đang chạy ngầm
if ! curl -sf "${URL}/api/health" >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-unit-files linhbridge.service >/dev/null 2>&1; then
    systemctl --user start linhbridge.service || true
  fi
fi

if ! curl -sf "${URL}/api/health" >/dev/null 2>&1; then
  nohup node "${APP_DIR}/server/index.js" >/tmp/linhbridge.log 2>&1 &
  for _ in $(seq 1 25); do
    if curl -sf "${URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.15
  done
fi

# 2. Mở giao diện bằng ChromeOS Chrome (hoặc trình duyệt mặc định)
if command -v garcon-url-handler >/dev/null 2>&1; then
  exec garcon-url-handler "${URL}"
elif command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "${URL}"
else
  echo "LinhBridge đang chạy tại: ${URL}"
fi
