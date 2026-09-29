#!/usr/bin/env bash
# Deploys or redeploys saarnavideo on this server:
#   clone (first run) or pull, create .env.server with fresh secrets (first run), build the app and
#   worker images, start PostgreSQL, apply the Prisma schema (prisma db push), (re)start the web app on
#   127.0.0.1:4103 for the host's nginx, and the worker.
#
#   bash /home/deploy/deploy/saarnavideo/scripts/server-deploy.sh
#   (or a copy of this file from anywhere: it clones the repository on the first run)
#
# Environment (all optional):
#   BASE_DIR       /home/deploy/deploy        the checkout goes to $BASE_DIR/saarnavideo
#   DEPLOY_BRANCH  main                       branch to deploy
#   REPO_URL       https://github.com/jsilvanus/saarnavideo.git
#   DOMAIN         asked on the first run     public domain (only used when .env.server is created)
#   HOST_PORT      4103                       127.0.0.1 port nginx proxies to (first run only)
#
# Secrets live in $BASE_DIR/saarnavideo/.env.server (mode 600, gitignored). It is never overwritten;
# edit it (YouTube/Facebook credentials, ...) and run this script again to apply changes.
# Transcription uses liturgos-auditor (its own server script) over the Docker network deploy-shared.
set -euo pipefail

NAME=saarnavideo
DEFAULT_DOMAIN=saarnavideo.italeino.fi
BASE_DIR=${BASE_DIR:-/home/deploy/deploy}
APP_DIR=$BASE_DIR/$NAME
BRANCH=${DEPLOY_BRANCH:-main}
REPO_URL=${REPO_URL:-https://github.com/jsilvanus/$NAME.git}
ENV_FILE=$APP_DIR/.env.server
KEPT_ENV=$BASE_DIR/.kept/$NAME.env
SHARED_NETWORK=deploy-shared
SELF=scripts/server-deploy.sh

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
secret() { openssl rand -hex 32; }

command -v git >/dev/null || die "git is not installed"
command -v openssl >/dev/null || die "openssl is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available for $(id -un)"

# --- 1. Code ------------------------------------------------------------------------------------
# After updating the checkout, re-run the checkout's own copy of this script (once), so a changed
# script takes effect in the same deployment.
if [ -z "${SERVER_DEPLOY_REEXEC:-}" ]; then
  if [ -d "$APP_DIR/.git" ]; then
    log "Updating $APP_DIR ($BRANCH)"
    git -C "$APP_DIR" fetch --prune origin "$BRANCH"
    git -C "$APP_DIR" checkout -q "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  else
    [ -e "$APP_DIR" ] && die "$APP_DIR exists but is not a git checkout"
    log "Cloning $REPO_URL ($BRANCH) into $APP_DIR"
    mkdir -p "$BASE_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
  if [ -f "$APP_DIR/$SELF" ]; then
    SERVER_DEPLOY_REEXEC=1 exec bash "$APP_DIR/$SELF" "$@"
  fi
fi
cd "$APP_DIR"
log "Deploying $NAME at commit $(git rev-parse --short HEAD)"

# --- 2. Settings and secrets (first run only) ----------------------------------------------------
if [ ! -f "$ENV_FILE" ] && [ -f "$KEPT_ENV" ]; then
  log "Restoring settings kept by server-delete.sh ($KEPT_ENV)"
  mv "$KEPT_ENV" "$ENV_FILE"
fi
if [ ! -f "$ENV_FILE" ]; then
  if [ -z "${DOMAIN:-}" ] && [ -t 0 ]; then
    read -r -p "Public domain for $NAME [$DEFAULT_DOMAIN]: " DOMAIN
  fi
  DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
  # Reuse liturgos-auditor's API key when it is already deployed next to this app.
  STT_KEY=
  if [ -f "$BASE_DIR/liturgos-auditor/.env.server" ]; then
    STT_KEY=$(sed -n 's/^AUDITOR_STT_API_KEY=//p' "$BASE_DIR/liturgos-auditor/.env.server" | tail -n 1)
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# saarnavideo server settings (scripts/server-deploy.sh). Never commit this file.
DOMAIN=$DOMAIN
HOST_PORT=${HOST_PORT:-4103}

# Bundled PostgreSQL (docker-compose.server.yml). The password only applies when the volume is created.
POSTGRES_PASSWORD=$(secret)

NEXT_PUBLIC_API_URL=https://$DOMAIN
MAX_CONCURRENT_JOBS=2
WORKER_POLL_MS=750

# YouTube (docs/YOUTUBE_OAUTH_SETUP.md). Keep the encryption key stable: changing it invalidates stored tokens.
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://$DOMAIN/api/integrations/youtube/callback
YOUTUBE_TOKEN_ENCRYPTION_KEY=$(secret)

# Facebook Page publishing (docs/FACEBOOK_SETUP.md).
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_GRAPH_VERSION=v24.0

# Speech-to-text: liturgos-auditor on the shared Docker network (AUDITOR_STT_API_KEY = its key).
AUDITOR_STT_URL=http://liturgos-auditor:8090
AUDITOR_STT_API_KEY=$STT_KEY

INTERNAL_API_SECRET=$(secret)
EOF
  chmod 600 "$ENV_FILE"
  log "Created $ENV_FILE (fill in YouTube/Facebook credentials there when needed)"
fi

dc() { docker compose -p "$NAME" --project-directory "$APP_DIR" -f docker-compose.server.yml --env-file "$ENV_FILE" "$@"; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

# --- 3. Build, database, schema, start -----------------------------------------------------------
docker network inspect "$SHARED_NETWORK" >/dev/null 2>&1 || docker network create "$SHARED_NETWORK" >/dev/null

log "Building images"
dc build --pull

log "Starting database"
dc up -d --wait db

# The project applies its Prisma schema with `db push` (no migration history). Without
# --accept-data-loss it refuses destructive changes; such a change needs a manual decision.
log "Applying the database schema (prisma db push)"
dc run --rm --no-deps worker npx prisma db push --schema prisma/schema.postgresql.prisma --skip-generate

log "Starting app and worker"
dc up -d --remove-orphans

# --- 4. Check ------------------------------------------------------------------------------------
PORT=$(env_value HOST_PORT)
for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
    docker image prune -f >/dev/null
    log "OK: $NAME is up on 127.0.0.1:$PORT (https://$(env_value DOMAIN) once nginx is set up)"
    exit 0
  fi
  sleep 2
done
dc logs --tail 50 app worker
die "$NAME did not answer on http://127.0.0.1:$PORT/"
