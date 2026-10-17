#!/usr/bin/env bash
# Runs your test set (eval/queries.jsonl) against the search at $SEARCH_URL and prints the metrics you chose.
# Exit 0 when it ran (whatever the scores). We run it when we grade; reviewers read what it prints.
set -euo pipefail
cd "$(dirname "$0")"
: "${SEARCH_URL:?Set SEARCH_URL, for example http://localhost:3000}"
echo "Not implemented yet: build your evaluation here." >&2
exit 1
