#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "============================================================"
echo "  LinkBridge — Cài đặt cho Chromebook Linux (Crostini)"
echo "============================================================"

# 1. Cài ADB nếu chưa có
if ! command -v adb >/dev/null 2>&1; then
  echo "[1/4] Đang cài android-tools-adb..."
  sudo apt-get update -qq
  sudo apt-get install -y android-tools-adb curl
else
  echo "[1/4] Đã có ADB: $(adb version | head -n 1)"
fi

# 2. Kiểm tra Node.js >= 18
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    NEED_NODE=1
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  echo "[2/4] Đang cài Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/4] Đã có Node.js: $(node -v)"
fi

# 3. Kiểm tra scrcpy-server v5.0.1
mkdir -p bin
if [ ! -f bin/scrcpy-server ]; then
  echo "[3/4] Đang tải scrcpy-server v5.0.1 chính thức từ GitHub..."
  curl -fL "https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-server-v5.0.1" -o bin/scrcpy-server
else
  echo "[3/4] Đã có sẵn bin/scrcpy-server ($(du -h bin/scrcpy-server | cut -f1))"
fi

# 4. Cài thư viện Node.js
echo "[4/4] Đang cài thư viện (express, ws)..."
npm install --no-fund --no-audit

chmod +x start.sh setup.sh bin/phone-ctl

echo ""
echo "✓ Cài đặt hoàn tất!"
echo "  Chạy ngay bằng lệnh:  ./start.sh"
echo "  Sau đó mở Chrome trên Chromebook và vào:  http://localhost:3000"
echo ""
