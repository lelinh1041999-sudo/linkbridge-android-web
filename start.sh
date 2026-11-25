#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Chưa cài thư viện. Đang chạy ./setup.sh..."
  ./setup.sh
fi

exec node server/index.js
