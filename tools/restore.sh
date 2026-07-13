#!/usr/bin/env bash
set -euo pipefail

# Restore from a backup directory created by tools/backup.sh
# Usage:
#   bash tools/restore.sh backups/workbench-20260713-120000

if [[ $# -lt 1 ]]; then
  echo "Usage: bash tools/restore.sh <backup-dir>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_PATH="$1"
ARTIFACT_DIR="${WORKSPACE_ARTIFACT_DIR:-$ROOT_DIR/workspace-artifacts}"

if [[ ! -d "$BACKUP_PATH" ]]; then
  echo "backup dir not found: $BACKUP_PATH" >&2
  exit 1
fi

echo "[restore] from $BACKUP_PATH"

if [[ -f "$BACKUP_PATH/postgres.dump" ]]; then
  if [[ -z "${WORKSPACE_DATABASE_URL:-}" ]]; then
    echo "WORKSPACE_DATABASE_URL is required to restore postgres dump" >&2
    exit 1
  fi
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore not found" >&2
    exit 1
  fi
  echo "[restore] restoring postgres dump"
  pg_restore --clean --if-exists --no-owner --dbname="$WORKSPACE_DATABASE_URL" "$BACKUP_PATH/postgres.dump"
elif [[ -f "$BACKUP_PATH/workspace.sqlite3" ]]; then
  echo "[restore] restoring sqlite database"
  cp "$BACKUP_PATH/workspace.sqlite3" "$ROOT_DIR/workspace.sqlite3"
else
  echo "[restore] no database dump found"
fi

if [[ -f "$BACKUP_PATH/artifacts.tar.gz" ]]; then
  echo "[restore] restoring artifacts into $ARTIFACT_DIR"
  mkdir -p "$(dirname "$ARTIFACT_DIR")"
  tar -xzf "$BACKUP_PATH/artifacts.tar.gz" -C "$(dirname "$ARTIFACT_DIR")"
else
  echo "[restore] no artifacts archive found"
fi

echo "[restore] done"
