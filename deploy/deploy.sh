#!/usr/bin/env bash
# build and deploy the backend (re-run to ship a new version): bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

gcloud run deploy "$SERVICE" --source=backend --region="$REGION" $P \
  --service-account="$API_SA" --allow-unauthenticated \
  --timeout=900 --concurrency=20 --max-instances=3 --memory=512Mi \
  --set-secrets=VALYU_API_KEY=valyu-api-key:latest,ACCESS_CODE=access-code:latest \
  --set-env-vars="^;^STORE=firestore;PIPELINE=valyu;QUEUE=cloudtasks;GOOGLE_CLOUD_PROJECT=$PROJECT;TASKS_LOCATION=$REGION;TASKS_QUEUE=$QUEUE;TASKS_SA=$TASKS_SA;WORKER_URL=$URL;CORS_ORIGIN=$CORS_ORIGIN"

# in case undeploy.sh paused it
gcloud tasks queues resume "$QUEUE" --location="$REGION" $P >/dev/null

echo "$URL"
curl -s "$URL/health"; echo
