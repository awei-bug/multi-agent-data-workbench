#!/usr/bin/env bash
# 从 CI/本机通过 SSH 部署到远程主机
# 依赖环境变量：
#   DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY_PATH
#   IMAGE_PREFIX, IMAGE_TAG
# 可选：
#   DEPLOY_PORT=22
#   DEPLOY_PATH=/opt/workbench
#   DEPLOY_ENV_FILE=/opt/workbench/.env
#   HEALTH_URL=http://127.0.0.1:8787/api/health/ready
#   REGISTRY_USER / REGISTRY_TOKEN
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/workbench}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$DEPLOY_PATH/.env}"
IMAGE_PREFIX="${IMAGE_PREFIX:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/health/ready}"
REGISTRY="${REGISTRY:-ghcr.io}"
REGISTRY_USER="${REGISTRY_USER:-}"
REGISTRY_TOKEN="${REGISTRY_TOKEN:-}"
KNOWN_HOSTS_PATH="${KNOWN_HOSTS_PATH:-}"

if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_USER" || -z "$DEPLOY_SSH_KEY_PATH" ]]; then
  echo "DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY_PATH are required" >&2
  exit 1
fi
if [[ -z "$IMAGE_PREFIX" || -z "$IMAGE_TAG" ]]; then
  echo "IMAGE_PREFIX and IMAGE_TAG are required" >&2
  exit 1
fi
if [[ ! -f "$DEPLOY_SSH_KEY_PATH" ]]; then
  echo "SSH key not found: $DEPLOY_SSH_KEY_PATH" >&2
  exit 1
fi

SSH_OPTS=(-i "$DEPLOY_SSH_KEY_PATH" -p "$DEPLOY_PORT" -o StrictHostKeyChecking=yes)
if [[ -n "$KNOWN_HOSTS_PATH" ]]; then
  SSH_OPTS+=(-o "UserKnownHostsFile=$KNOWN_HOSTS_PATH")
else
  SSH_OPTS+=(-o StrictHostKeyChecking=accept-new)
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "==> Ensure remote directory: ${DEPLOY_PATH}"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '${DEPLOY_PATH}' '${DEPLOY_PATH}/dist'"

echo "==> Sync compose and deploy script"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '${DEPLOY_PATH}/tools'"
scp "${SSH_OPTS[@]}" \
  docker-compose.release.yml \
  "$REMOTE:${DEPLOY_PATH}/docker-compose.release.yml"
scp "${SSH_OPTS[@]}" \
  tools/remote-deploy.sh \
  "$REMOTE:${DEPLOY_PATH}/tools/remote-deploy.sh"
ssh "${SSH_OPTS[@]}" "$REMOTE" "chmod +x '${DEPLOY_PATH}/tools/remote-deploy.sh'"

echo "==> Run remote deploy"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "cd '${DEPLOY_PATH}' && \
   IMAGE_PREFIX='${IMAGE_PREFIX}' \
   IMAGE_TAG='${IMAGE_TAG}' \
   ENV_FILE='${DEPLOY_ENV_FILE}' \
   COMPOSE_FILE='docker-compose.release.yml' \
   HEALTH_URL='${HEALTH_URL}' \
   REGISTRY='${REGISTRY}' \
   REGISTRY_USER='${REGISTRY_USER}' \
   REGISTRY_TOKEN='${REGISTRY_TOKEN}' \
   bash tools/remote-deploy.sh"

echo "==> Remote deploy finished: ${REMOTE}:${DEPLOY_PATH} @ ${IMAGE_TAG}"
