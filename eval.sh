#!/usr/bin/env bash
# Run exactly 20 judged queries against the running search and independently check live inventory.
set -euo pipefail
cd "$(dirname "$0")"
: "${SEARCH_URL:?Set SEARCH_URL to the running search base URL}"
python3 eval.py
