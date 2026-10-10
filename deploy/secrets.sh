#!/usr/bin/env bash
# copies VALYU_API_KEY and ACCESS_CODE from backend/.env into Secret Manager (safe to re-run, then redeploy so the service picks up the new values): bash deploy/secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

for name in VALYU_API_KEY ACCESS_CODE; do
  value=$(env_value "$name")
  [ -n "$value" ] || {
    echo "$name is empty in backend/.env" >&2
    exit 1
  }
  secret=$(echo "$name" | tr 'A-Z_' 'a-z-') # VALYU_API_KEY -> valyu-api-key
  gcloud secrets describe "$secret" $P >/dev/null 2>&1 || gcloud secrets create "$secret" $P
  printf %s "$value" | gcloud secrets versions add "$secret" --data-file=- $P
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$API_SA" --role=roles/secretmanager.secretAccessor $P >/dev/null
done
