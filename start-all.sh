#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Đang cài thư viện Node.js (lần đầu)..."
  npm install --no-fund --no-audit
fi

# Dọn tiến trình cũ nếu đang chạy
pkill -f "server/index.js" 2>/dev/null || true
pkill -f "agent/crostini-agent.js" 2>/dev/null || true
sleep 0.3

# Tự tắt cả 2 tiến trình gọn gàng khi nhấn Ctrl+C
SERVER_PID=""
cleanup() {
  echo ""
  echo "[LinhBridge] Đang tắt cả localhost:3000 và Crostini Agent..."
  if [ -n "${SERVER_PID}" ]; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup INT TERM EXIT

# 1. Chạy Bridge Wi-Fi (http://localhost:3000) chạy nền trong phiên này
node server/index.js >/tmp/linhbridge-server.log 2>&1 &
SERVER_PID=$!

# Đợi server mở cổng 3000 (tối đa 3 giây)
for _ in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.15
done

echo "✓ Web LinhBridge Wi-Fi đã sẵn sàng tại: http://localhost:3000"
echo "  (Nhấn Ctrl + C 1 lần để tắt CẢ HAI)"

# 2. Chạy Crostini Agent ở cửa sổ chính để hiện mã phòng CB-xxxx gửi cho AI
node agent/crostini-agent.js
