#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/wacalls"
CONTAINER_NAME="wacalls-postgres-1"
DB_USER="wacalls"
DB_NAME="wacalls"
RETENTION_DAYS=7
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/wacalls_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"
echo "[$(date -Iseconds)] Starting PostgreSQL backup for ${DB_NAME}..."

docker exec -i "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${BACKUP_FILE}"

if [ -s "${BACKUP_FILE}" ]; then
  FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "[$(date -Iseconds)] Backup created successfully: ${BACKUP_FILE} (${FILE_SIZE})"
else
  echo "[$(date -Iseconds)] ERROR: Backup file is empty or failed to create!" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "wacalls_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
echo "[$(date -Iseconds)] Backup routine completed."