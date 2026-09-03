#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"
"${APP_DIR}/scripts/backup.sh"
if [[ -d .git ]]; then
  git checkout -- nginx/default.conf 2>/dev/null || true
  git pull --ff-only
fi
DOMAIN="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
if [[ -n "${DOMAIN}" && -f "${APP_DIR}/certbot-certs/live/${DOMAIN}/fullchain.pem" ]]; then
  sed "s/\${DOMAIN}/${DOMAIN}/g" "${APP_DIR}/nginx/ssl.conf.tpl" > "${APP_DIR}/nginx/default.conf"
fi
docker compose build
docker compose up -d
sleep 8
docker compose exec -T api sh -c 'cd /app && pnpm --filter @wacalls/database migrate'
docker compose up -d --force-recreate whatsapp
sleep 4
if curl -fsS http://127.0.0.1/health >/dev/null || curl -fsSk https://127.0.0.1/health >/dev/null; then
  echo "Health check passed"
else
  echo "Health check failed. Recent logs:"
  docker compose logs --tail=80 api worker whatsapp nginx
  exit 1
fi
