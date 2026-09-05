#!/usr/bin/env bash
set -euo pipefail

# Install a daily backup cron entry (Linux hosts).
# Usage:
#   sudo bash tools/install-backup-cron.sh
#   BACKUP_DIR=/var/backups/workbench sudo bash tools/install-backup-cron.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/workbench}"
CRON_FILE="/etc/cron.d/workbench-backup"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "$BACKUP_DIR"
chmod +x "$ROOT_DIR/tools/backup.sh" "$ROOT_DIR/tools/restore.sh"

cat > "$CRON_FILE" <<EOF
# Workbench daily backup at 02:17 local time
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 2 * * * root cd '$ROOT_DIR' && BACKUP_DIR='$BACKUP_DIR' bash tools/backup.sh >> '$LOG_FILE' 2>&1
EOF

chmod 644 "$CRON_FILE"
echo "[install-backup-cron] wrote $CRON_FILE"
echo "[install-backup-cron] backups -> $BACKUP_DIR"
echo "[install-backup-cron] restore drill: bash tools/restore.sh <backup-dir>"
