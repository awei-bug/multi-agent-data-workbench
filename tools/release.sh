#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE_PREFIX="${IMAGE_PREFIX:-workbench}"
TAG="${TAG:-}"
PUSH="${PUSH:-false}"
DEPLOY="${DEPLOY:-false}"
ENV_FILE="${ENV_FILE:-.env}"
REGISTRY="${REGISTRY:-}"
USERNAME="${USERNAME:-}"
PASSWORD="${PASSWORD:-}"

if [[ -z "$TAG" ]]; then
  if TAG_FROM_GIT=$(git describe --tags --exact-match 2>/dev/null); then
    TAG="$TAG_FROM_GIT"
  else
    TAG="sha-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
  fi
fi

BACKEND_IMAGE="${IMAGE_PREFIX}/backend:${TAG}"
FRONTEND_IMAGE="${IMAGE_PREFIX}/frontend:${TAG}"

echo "Release version: ${TAG}"
echo "Backend image : ${BACKEND_IMAGE}"
echo "Frontend image: ${FRONTEND_IMAGE}"
echo "Worker image  : ${BACKEND_IMAGE}"

echo
echo "[1/4] Build backend image..."
docker build -t "${BACKEND_IMAGE}" -f backend/Dockerfile backend

echo
echo "[2/4] Build frontend image..."
docker build -t "${FRONTEND_IMAGE}" -f frontend/Dockerfile frontend

if [[ "${PUSH}" == "true" ]]; then
  if [[ -n "${REGISTRY}" && -n "${USERNAME}" && -n "${PASSWORD}" ]]; then
    echo
    echo "Login registry: ${REGISTRY}"
    echo "${PASSWORD}" | docker login "${REGISTRY}" -u "${USERNAME}" --password-stdin
  fi
  echo
  echo "[3/4] Push images..."
  docker push "${BACKEND_IMAGE}"
  docker push "${FRONTEND_IMAGE}"
else
  echo
  echo "[3/4] Skip push (set PUSH=true to enable)"
fi

mkdir -p dist
cat > dist/release-manifest.json <<EOF
{
  "version": "${TAG}",
  "imagePrefix": "${IMAGE_PREFIX}",
  "images": {
    "backend": "${BACKEND_IMAGE}",
    "frontend": "${FRONTEND_IMAGE}",
    "worker": "${BACKEND_IMAGE}"
  },
  "pushed": ${PUSH},
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "composeFile": "docker-compose.release.yml"
}
EOF
echo "Manifest written: dist/release-manifest.json"

if [[ "${DEPLOY}" == "true" ]]; then
  echo
  echo "[4/4] Deploy with docker-compose.release.yml..."
  export IMAGE_PREFIX TAG
  if [[ -f "${ENV_FILE}" ]]; then
    docker compose -f docker-compose.release.yml --env-file "${ENV_FILE}" up -d
  else
    docker compose -f docker-compose.release.yml up -d
  fi
else
  echo
  echo "[4/4] Skip deploy (set DEPLOY=true to enable)"
  echo "Example deploy:"
  echo "  IMAGE_PREFIX='${IMAGE_PREFIX}' IMAGE_TAG='${TAG}' docker compose -f docker-compose.release.yml --env-file .env up -d"
fi

echo
echo "Release complete."
