#!/usr/bin/env bash
# one real research task end to end (Valyu + Gemini, about $0.20): bash deploy/smoke.sh ["question"]
# BASE=http://localhost:3000 bash deploy/smoke.sh   to run against a local server
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh
BASE=${BASE:-$URL}
CODE=${CODE:-$(env_value ACCESS_CODE)}
Q=${1:-"How has the upper bound on the matrix multiplication exponent ω improved since 2020, which refinements of the laser method produced those improvements, and what do known barrier results say about whether these techniques can ever reach ω = 2?"}
auth=(-H "Authorization: Bearer $CODE")

echo "health: $(curl -sf "$BASE/health")"
id=$(curl -sf -X POST "$BASE/tasks" "${auth[@]}" -H 'content-type: application/json' \
  -d "$(jq -n --arg q "$Q" '{prompt:$q}')" | jq -r .task_id)
echo "task:   $id"

for _ in $(seq 1 120); do
  s=$(curl -sf "${auth[@]}" "$BASE/tasks/$id" | jq -r .status)
  printf "\r%-12s" "$s"
  case $s in completed | failed | cancelled) break ;; esac
  sleep 5
done
echo
curl -sf "${auth[@]}" "$BASE/tasks/$id" | jq '{status, error, cost,
  searches: [.events[] | select(.type=="search") | {round, scope, query, found, newSources}],
  cited: (.sources | length)}'
curl -sf "${auth[@]}" "$BASE/tasks/$id" | jq -r '.report // empty' | head -20
[ "$s" = completed ]
