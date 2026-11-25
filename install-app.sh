#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${APP_DIR}"

echo "============================================================"
echo "  LinhBridge — Cài thành App & Dịch vụ nền trên Chromebook"
echo "============================================================"

# 1. Chạy cài đặt cơ bản (ADB, Node.js, npm packages)
chmod +x setup.sh start.sh uninstall-app.sh bin/phone-ctl bin/launch-app.sh
./setup.sh

NODE_BIN="$(command -v node)"

# 2. Cài systemd user service để Wi-Fi Bridge tự chạy ngầm khi bật Linux Crostini
mkdir -p "${HOME}/.config/systemd/user"
cat > "${HOME}/.config/systemd/user/linhbridge.service" <<EOF
[Unit]
Description=LinhBridge Android Ultra-Low-Latency Web Remote Bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server/index.js
Restart=on-failure
RestartSec=3
Environment=PORT=3000

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
  systemctl --user enable --now linhbridge.service
  echo "[✓] Đã bật dịch vụ chạy ngầm linhbridge.service (tự chạy cùng Crostini)."
else
  nohup "${NODE_BIN}" "${APP_DIR}/server/index.js" >/tmp/linhbridge.log 2>&1 &
  echo "[✓] Đã khởi chạy LinhBridge chạy nền."
fi

# 3. Cài icon & Desktop Entry -> tự hiện trong App Launcher của Chromebook!
mkdir -p "${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "${HOME}/.local/share/applications"
cp "${APP_DIR}/public/icons/icon-512.png" "${HOME}/.local/share/icons/hicolor/512x512/apps/linhbridge.png"

cat > "${HOME}/.local/share/applications/linhbridge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LinhBridge
GenericName=Android Remote Control
Comment=Điều khiển Samsung S26 & Android siêu mượt qua Web (Wi-Fi & USB)
Exec=${APP_DIR}/bin/launch-app.sh
Icon=linhbridge
Terminal=false
Categories=Utility;Network;
StartupNotify=true
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
fi

# 4. Tạo lệnh toàn cục phone-ctl
mkdir -p "${HOME}/.local/bin"
ln -sf "${APP_DIR}/bin/phone-ctl" "${HOME}/.local/bin/phone-ctl"

echo ""
echo "============================================================"
echo "  CÀI ĐẶT THÀNH CÔNG!"
echo "============================================================"
echo "  1. Mở App Launcher (nút Tìm kiếm trên Chromebook) -> Linux apps -> bấm icon LinhBridge!"
echo "  2. Hoặc mở trực tiếp trên Chrome:"
echo "     • Nội bộ:       http://localhost:3000"
echo "     • Bản Web PWA:  https://lelinh1041999-sudo.github.io/linkbridge-android-web/"
echo "  3. Bấm nút 'Cài App' trên thanh công cụ web để ghim LinhBridge thành cửa sổ riêng như Phone Link!"
echo "  4. Lệnh CLI nhanh: ${HOME}/.local/bin/phone-ctl help"
echo ""
