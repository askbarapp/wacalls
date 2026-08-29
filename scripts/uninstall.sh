#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
KEEP_DATA=0
if [[ "${1:-}" == "--keep-data" ]]; then
  KEEP_DATA=1
fi

echo "Do you really want to remove WaCalls?"
echo "This may delete application containers."
echo
echo "Type:"
echo "DELETE WACALLS"
read -r confirm
if [[ "${confirm}" != "DELETE WACALLS" ]]; then
  echo "Aborted."
  exit 1
fi

cd "${APP_DIR}"
if [[ "${KEEP_DATA}" -eq 1 ]]; then
  docker compose down
  echo "Containers removed. Named volumes were kept."
else
  docker compose down
  echo "Containers stopped. Named volumes were NOT deleted."
  echo "To destroy data volumes as well, run: docker volume rm wacalls_postgres_data wacalls_redis_data wacalls_whatsapp_sessions wacalls_recordings"
fi
