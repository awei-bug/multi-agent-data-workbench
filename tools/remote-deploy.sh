#!/usr/bin/env bash
# 远程/本机通用发布脚本：拉取预构建镜像并滚动更新
# 用法：
#   IMAGE_PREFIX=ghcr.io/org/repo IMAGE_TAG=v1.0.0 bash tools/remote-deploy.sh
#   bash tools/remote-deploy.sh --prefix ghcr.io/org/repo --tag v1.0.0 --env-file /opt/workbench/.env
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE_PREFIX="${IMAGE_PREFIX:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.release.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-2}"
REGISTRY="${REGISTRY:-ghcr.io}"
REGISTRY_USER="${REGISTRY_USER:-}"
REGISTRY_TOKEN="${REGISTRY_TOKEN:-}"
SKIP_LOGIN="${SKIP_LOGIN:-false}"
SKIP_PULL="${SKIP_PULL:-false}"

usage() {
  cat <<'EOF'
Usage: remote-deploy.sh [options]

Options:
  --prefix <image-prefix>   e.g. ghcr.io/owner/repo
  --tag <image-tag>         e.g. v1.0.0 / main / sha-abc1234
  --env-file <path>         default: .env
  --compose-file <path>     default: docker-compose.release.yml
  --health-url <url>        default: http://127.0.0.1:8787/api/health/ready
  --registry <host>         default: ghcr.io
  --registry-user <user>
  --registry-token <token>
  --skip-login
  --skip-pull
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) IMAGE_PREFIX="$2"; shift 2 ;;
    --tag) IMAGE_TAG="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --registry-user) REGISTRY_USER="$2"; shift 2 ;;
    --registry-token) REGISTRY_TOKEN="$2"; shift 2 ;;
    --skip-login) SKIP_LOGIN="true"; shift ;;
    --skip-pull) SKIP_PULL="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "${IMAGE_PREFIX}" ]]; then
  echo "IMAGE_PREFIX is required (e.g. ghcr.io/owner/repo)" >&2
  exit 1
fi
if [[ -z "${IMAGE_TAG}" ]]; then
  echo "IMAGE_TAG is required (e.g. v1.0.0)" >&2
  exit 1
fi
if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

export IMAGE_PREFIX IMAGE_TAG

echo "==> Deploy configuration"
echo "    IMAGE_PREFIX=${IMAGE_PREFIX}"
echo "    IMAGE_TAG=${IMAGE_TAG}"
echo "    COMPOSE_FILE=${COMPOSE_FILE}"
echo "    ENV_FILE=${ENV_FILE}"
echo "    HEALTH_URL=${HEALTH_URL}"

if [[ "${SKIP_LOGIN}" != "true" && -n "${REGISTRY_USER}" && -n "${REGISTRY_TOKEN}" ]]; then
  echo "==> Login registry: ${REGISTRY}"
  echo "${REGISTRY_TOKEN}" | docker login "${REGISTRY}" -u "${REGISTRY_USER}" --password-stdin
fi

COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
if [[ -f "${ENV_FILE}" ]]; then
  COMPOSE_ARGS+=(--env-file "${ENV_FILE}")
else
  echo "Warning: env file not found (${ENV_FILE}), continue with process env only"
fi

if [[ "${SKIP_PULL}" != "true" ]]; then
  echo "==> Pull images"
  docker compose "${COMPOSE_ARGS[@]}" pull
fi

echo "==> Start/update services"
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans

echo "==> Service status"
docker compose "${COMPOSE_ARGS[@]}" ps

echo "==> Health check: ${HEALTH_URL}"
ok=0
for ((i=1; i<=HEALTH_RETRIES; i++)); do
  if curl -fsS "${HEALTH_URL}" >/tmp/workbench-health.json 2>/dev/null; then
    echo "Health check passed on attempt ${i}"
    cat /tmp/workbench-health.json || true
    ok=1
    break
  fi
  echo "Attempt ${i}/${HEALTH_RETRIES} failed, retry in ${HEALTH_INTERVAL_SECONDS}s..."
  sleep "${HEALTH_INTERVAL_SECONDS}"
done

if [[ "${ok}" -ne 1 ]]; then
  echo "Health check failed after ${HEALTH_RETRIES} attempts" >&2
  docker compose "${COMPOSE_ARGS[@]}" ps >&2 || true
  docker compose "${COMPOSE_ARGS[@]}" logs --tail=100 backend worker >&2 || true
  exit 1
fi

mkdir -p dist
cat > dist/deploy-result.json <<EOF
{
  "imagePrefix": "${IMAGE_PREFIX}",
  "imageTag": "${IMAGE_TAG}",
  "composeFile": "${COMPOSE_FILE}",
  "envFile": "${ENV_FILE}",
  "healthUrl": "${HEALTH_URL}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "ok"
}
EOF

echo "==> Deploy complete"
echo "    Result: dist/deploy-result.json"
