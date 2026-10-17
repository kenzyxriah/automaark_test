#!/usr/bin/env bash
# Starts the search API on $PORT (default 3000). Must answer GET /health with 200 within 60 seconds.
set -euo pipefail
cd "$(dirname "$0")"
exec node dist/main.js
