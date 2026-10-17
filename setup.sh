#!/usr/bin/env bash
# Installs and builds everything. Network is available here, and not afterwards.
# A Postgres 16 with pgvector is available at $DATABASE_URL if you want one (optional; load your data here or at start).
set -euo pipefail
cd "$(dirname "$0")"
npm ci --no-audit --no-fund
npm run build
