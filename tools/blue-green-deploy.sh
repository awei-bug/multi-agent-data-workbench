#!/usr/bin/env bash
set -euo pipefail

# Blue/Green deploy for compose-based hosts.
# Usage:
#   IMAGE_PREFIX=ghcr.io/org/repo IMAGE_TAG=v1.2.0 bash tools/blue-green-deploy.sh
#
# Layout:
#   DEPLOY_ROOT/
#     blue/   docker-compose.release.yml + .env
#     green/  docker-compose.release.yml + .env
#     current -> blue|green

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/workbench}"
IMAGE_PREFIX="${IMAGE_PREFIX:?IMAGE_PREFIX required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG required}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.release.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-2}"
ACTIVE_LINK="${DEPLOY_ROOT}/current"

mkdir -p "$DEPLOY_ROOT/blue" "$DEPLOY_ROOT/green"

if [[ -L "$ACTIVE_LINK" ]]; then
  CURRENT_SLOT="$(basename "$(readlink "$ACTIVE_LINK")")"
else
  CURRENT_SLOT="blue"
  ln -sfn "$DEPLOY_ROOT/blue" "$ACTIVE_LINK"
fi

if [[ "$CURRENT_SLOT" == "blue" ]]; then
  TARGET_SLOT="green"
else
  TARGET_SLOT="blue"
fi

TARGET_DIR="$DEPLOY_ROOT/$TARGET_SLOT"
echo "[blue-green] current=$CURRENT_SLOT target=$TARGET_SLOT"

# Ensure target has compose + env.
if [[ ! -f "$TARGET_DIR/$COMPOSE_FILE" ]]; then
  if [[ -f "$ACTIVE_LINK/$COMPOSE_FILE" ]]; then
    cp "$ACTIVE_LINK/$COMPOSE_FILE" "$TARGET_DIR/$COMPOSE_FILE"
  else
    echo "missing compose file in $TARGET_DIR" >&2
    exit 1
  fi
fi
if [[ ! -f "$TARGET_DIR/.env" && -f "$ACTIVE_LINK/.env" ]]; then
  cp "$ACTIVE_LINK/.env" "$TARGET_DIR/.env"
fi

export IMAGE_PREFIX IMAGE_TAG
cd "$TARGET_DIR"

echo "[blue-green] pulling images"
docker compose -f "$COMPOSE_FILE" --env-file .env pull

echo "[blue-green] starting target slot: $TARGET_SLOT"
docker compose -p "workbench-$TARGET_SLOT" -f "$COMPOSE_FILE" --env-file .env up -d

echo "[blue-green] health checking $HEALTH_URL"
ok=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP_SECONDS"
done

if [[ "$ok" -ne 1 ]]; then
  echo "[blue-green] health check failed; rolling back target slot" >&2
  docker compose -p "workbench-$TARGET_SLOT" -f "$COMPOSE_FILE" --env-file .env down || true
  exit 1
fi

echo "[blue-green] switching current -> $TARGET_SLOT"
ln -sfn "$TARGET_DIR" "$ACTIVE_LINK"

if [[ "${STOP_OLD_SLOT:-true}" == "true" ]]; then
  echo "[blue-green] stopping old slot: $CURRENT_SLOT"
  if [[ -f "$DEPLOY_ROOT/$CURRENT_SLOT/$COMPOSE_FILE" ]]; then
    (
      cd "$DEPLOY_ROOT/$CURRENT_SLOT"
      docker compose -p "workbench-$CURRENT_SLOT" -f "$COMPOSE_FILE" --env-file .env down || true
    )
  fi
fi

echo "[blue-green] done. active=$TARGET_SLOT tag=$IMAGE_TAG"
