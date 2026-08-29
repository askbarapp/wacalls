#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
BACKUP_DIR="${APP_DIR}/backups"
RETENTION="${BACKUP_RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BACKUP_DIR}"
cd "${APP_DIR}"
# shellcheck source=/dev/null
. .env

echo "Backing up PostgreSQL..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_DIR}/db-${STAMP}.sql.gz"

echo "Backing up WhatsApp sessions and recordings..."
docker run --rm \
  -v wacalls_whatsapp_sessions:/data/sessions:ro \
  -v wacalls_recordings:/data/recordings:ro \
  -v "${BACKUP_DIR}:/backup" \
  alpine tar czf "/backup/files-${STAMP}.tar.gz" -C / data

cp .env "${BACKUP_DIR}/env-${STAMP}.env"
chmod 600 "${BACKUP_DIR}/env-${STAMP}.env"

find "${BACKUP_DIR}" -type f -mtime "+${RETENTION}" -delete
echo "Backup complete: ${BACKUP_DIR}/*-${STAMP}*"
