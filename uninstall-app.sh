#!/usr/bin/env bash
set -euo pipefail

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now linhbridge.service >/dev/null 2>&1 || true
fi

rm -f "${HOME}/.config/systemd/user/linhbridge.service"
rm -f "${HOME}/.local/share/applications/linhbridge.desktop"
rm -f "${HOME}/.local/share/icons/hicolor/512x512/apps/linhbridge.png"
rm -f "${HOME}/.local/bin/phone-ctl"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

echo "✓ Đã gỡ dịch vụ chạy ngầm và icon LinhBridge khỏi Chromebook."
