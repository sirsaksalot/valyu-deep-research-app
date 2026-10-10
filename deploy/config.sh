# shared by all deploy scripts
PROJECT=${PROJECT:-valyu-research}
REGION=${REGION:-asia-southeast1} # same as Firestore
SERVICE=research-api
QUEUE=research-tasks
API_SA=research-api@$PROJECT.iam.gserviceaccount.com     # runs the service
TASKS_SA=research-tasks@$PROJECT.iam.gserviceaccount.com # signs Cloud Tasks calls
CORS_ORIGIN=${CORS_ORIGIN:-"*"} # set to the Vercel URL once the frontend is deployed
P="--project=$PROJECT"

NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
URL="https://$SERVICE-$NUMBER.$REGION.run.app" # Cloud Run URLs are predictable

# KEY=value from backend/.env, quotes stripped
env_value() {
  { grep -E "^$1=" backend/.env || true; } | tail -1 | cut -d= -f2- |
    sed -E 's/[[:space:]]+$//; s/^"(.*)"$/\1/'
}
