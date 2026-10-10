#!/usr/bin/env bash
# one-time GCP setup: bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/config.sh

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudtasks.googleapis.com \
  secretmanager.googleapis.com aiplatform.googleapis.com firestore.googleapis.com $P

gcloud iam service-accounts create research-api $P
gcloud iam service-accounts create research-tasks $P
for role in roles/datastore.user roles/aiplatform.user roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$API_SA" --role="$role" --condition=None >/dev/null
done
# lets the API create tasks that carry the research-tasks identity
gcloud iam service-accounts add-iam-policy-binding "$TASKS_SA" \
  --member="serviceAccount:$API_SA" --role=roles/iam.serviceAccountUser $P >/dev/null
# source deploys build as the default compute service account
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None >/dev/null

gcloud tasks queues create "$QUEUE" --location="$REGION" \
  --max-concurrent-dispatches=5 --max-dispatches-per-second=1 \
  --max-attempts=3 --min-backoff=30s $P

bash deploy/secrets.sh
echo "next: bash deploy/deploy.sh"
