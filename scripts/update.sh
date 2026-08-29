#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"
"${APP_DIR}/scripts/backup.sh"
if [[ -d .git ]]; then
  # Live HTTPS writes nginx/default.conf; reset it so git pull is not blocked.
  git checkout -- nginx/default.conf 2>/dev/null || true
  git pull --ff-only
fi
# Repo tracks HTTP-only nginx/default.conf. Re-apply SSL if certs already exist.
if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  set -a
  . ./.env
  set +a
fi
if [[ -n "${DOMAIN:-}" && -f "${APP_DIR}/certbot-certs/live/${DOMAIN}/fullchain.pem" ]]; then
  sed "s/\${DOMAIN}/${DOMAIN}/g" "${APP_DIR}/nginx/ssl.conf.tpl" > "${APP_DIR}/nginx/default.conf"
fi
docker compose build
docker compose up -d
sleep 8
docker compose exec -T api sh -c 'cd /app && pnpm --filter @wacalls/database migrate' || \
  docker compose exec -T api sh -c 'cd /app/packages/database && npx prisma migrate deploy'
if curl -fsS http://127.0.0.1/health >/dev/null || curl -fsSk https://127.0.0.1/health >/dev/null; then
  echo "Health check passed"
else
  echo "Health check failed. Recent logs:"
  docker compose logs --tail=80 api worker whatsapp nginx
  exit 1
fi
