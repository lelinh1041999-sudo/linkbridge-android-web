#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Đang cài thư viện Node.js (lần đầu)..."
  npm install --no-fund --no-audit
fi

exec node agent/crostini-agent.js
