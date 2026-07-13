#!/usr/bin/env bash
set -euo pipefail

# Backup PostgreSQL + local artifact directory.
# Usage:
#   bash tools/backup.sh
#   BACKUP_DIR=/var/backups/workbench bash tools/backup.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
ARTIFACT_DIR="${WORKSPACE_ARTIFACT_DIR:-$ROOT_DIR/workspace-artifacts}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/workbench-$TIMESTAMP"
mkdir -p "$TARGET"

echo "[backup] writing to $TARGET"

if [[ -n "${WORKSPACE_DATABASE_URL:-}" ]]; then
  echo "[backup] dumping postgres via WORKSPACE_DATABASE_URL"
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --no-owner --format=custom --file="$TARGET/postgres.dump" "$WORKSPACE_DATABASE_URL"
  else
    echo "[backup] pg_dump not found; skipping database dump" >&2
  fi
elif [[ -f "$ROOT_DIR/workspace.sqlite3" ]]; then
  echo "[backup] copying sqlite database"
  cp "$ROOT_DIR/workspace.sqlite3" "$TARGET/workspace.sqlite3"
else
  echo "[backup] no database source found; skipping db dump"
fi

if [[ -d "$ARTIFACT_DIR" ]]; then
  echo "[backup] archiving artifacts from $ARTIFACT_DIR"
  tar -czf "$TARGET/artifacts.tar.gz" -C "$(dirname "$ARTIFACT_DIR")" "$(basename "$ARTIFACT_DIR")"
else
  echo "[backup] artifact dir not found: $ARTIFACT_DIR"
fi

cat > "$TARGET/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "databaseUrlConfigured": $([ -n "${WORKSPACE_DATABASE_URL:-}" ] && echo true || echo false),
  "artifactDir": "${ARTIFACT_DIR}",
  "host": "$(hostname 2>/dev/null || echo unknown)"
}
EOF

echo "[backup] pruning backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type d -name 'workbench-*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +

echo "[backup] done: $TARGET"
