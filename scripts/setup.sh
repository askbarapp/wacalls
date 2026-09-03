#!/usr/bin/env bash
# WaCalls installer for Ubuntu 22.04 / 24.04
set -euo pipefail

APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
MIN_CPU=2
MIN_RAM_KB=$((3500 * 1024))
MIN_DISK_KB=$((25 * 1024 * 1024))

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    red "Run as root: sudo ./setup.sh"
    exit 1
  fi
}

check_os() {
  if [[ ! -f /etc/os-release ]]; then
    red "Unsupported OS"
    exit 1
  fi
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "${ID}" != "ubuntu" ]]; then
    red "This installer supports Ubuntu 22.04 and 24.04 LTS only (found ${ID})."
    exit 1
  fi
  case "${VERSION_ID}" in
    22.04|24.04) green "OS: Ubuntu ${VERSION_ID}" ;;
    *) yellow "Ubuntu ${VERSION_ID} is not a listed target. Continuing at your own risk." ;;
  esac
}

check_resources() {
  local cpus ram disk
  cpus="$(nproc)"
  ram="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  disk="$(df -k / | awk 'NR==2 {print $4}')"
  echo "CPU: ${cpus}  RAM: $((ram / 1024))MB  Free disk: $((disk / 1024 / 1024))GB"
  if (( cpus < MIN_CPU )); then yellow "Recommended minimum is ${MIN_CPU} CPU cores."; fi
  if (( ram < MIN_RAM_KB )); then yellow "Recommended minimum is 4 GB RAM."; fi
  if (( disk < MIN_DISK_KB )); then yellow "Recommended minimum is 40 GB disk."; fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y     curl git wget unzip ca-certificates gnupg ufw fail2ban \
    openssl jq dnsutils rsync
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    green "Docker already installed"
  else
    curl -fsSL https://get.docker.com | sh
  fi
  if ! docker compose version >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  fi
  systemctl enable --now docker
}

copy_app() {
  mkdir -p "${APP_DIR}"
  local src
  src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ "${src}" == "${APP_DIR}" ]]; then
    green "Already in ${APP_DIR}"
    return
  fi
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude dist --exclude .next \
    --exclude backups --exclude sessions --exclude .env \
    "${src}/" "${APP_DIR}/"
}

prompt_config() {
  if [[ ! -t 0 ]] && [[ ! -e /dev/tty ]]; then
    red "Installer needs an interactive terminal (email/password/domain)."
    red "Run: sudo bash ${APP_DIR}/scripts/setup.sh"
    exit 1
  fi
  read_tty() {
    local prompt="$1" var="$2" silent="${3:-}"
    if [[ -n "${silent}" ]]; then
      if [[ -e /dev/tty ]]; then read -r -s -p "${prompt}" "${var}" </dev/tty; echo >/dev/tty
      else read -r -s -p "${prompt}" "${var}"; echo
      fi
    else
      if [[ -e /dev/tty ]]; then read -r -p "${prompt}" "${var}" </dev/tty
      else read -r -p "${prompt}" "${var}"
      fi
    fi
  }

  echo
  read_tty "Admin email: " ADMIN_EMAIL
  local ADMIN_PASSWORD ADMIN_PASSWORD2
  read_tty "Admin password: " ADMIN_PASSWORD silent
  read_tty "Confirm admin password: " ADMIN_PASSWORD2 silent
  if [[ "${ADMIN_PASSWORD}" != "${ADMIN_PASSWORD2}" ]]; then
    red "Passwords do not match"
    exit 1
  fi
  if [[ ${#ADMIN_PASSWORD} -lt 10 ]]; then
    red "Password must be at least 10 characters"
    exit 1
  fi
  read_tty "Enter your domain (e.g. wacalls.example.com): " DOMAIN
  read_tty "Let's Encrypt email [${ADMIN_EMAIL}]: " LE_EMAIL
  LE_EMAIL="${LE_EMAIL:-${ADMIN_EMAIL}}"
  read_tty "Organization name [WaCalls]: " ORG_NAME
  ORG_NAME="${ORG_NAME:-WaCalls}"

  SERVER_IP="$(curl -4 -fsS https://ifconfig.me || hostname -I | awk '{print $1}')"
  echo
  yellow "Point these DNS A records at ${SERVER_IP} before SSL can succeed:"
  echo "  A    ${DOMAIN}        ${SERVER_IP}"
  echo "  A    www.${DOMAIN}    ${SERVER_IP}"
  echo "DNS is not configured automatically."
  read_tty "Press Enter once DNS is pointed here (or skip SSL later)..." _

  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  if [[ -f "${APP_DIR}/.env" ]] && grep -q '^POSTGRES_PASSWORD=' "${APP_DIR}/.env"; then
    yellow "Keeping existing PostgreSQL password so the data volume still authenticates."
    POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' "${APP_DIR}/.env" | cut -d= -f2-)"
  fi
  JWT_SECRET="$(openssl rand -hex 48)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  INTERNAL_TOKEN="$(openssl rand -hex 32)"
  if [[ -f "${APP_DIR}/.env" ]]; then
    JWT_SECRET="$(grep '^JWT_SECRET=' "${APP_DIR}/.env" | cut -d= -f2- || echo "${JWT_SECRET}")"
    ENCRYPTION_KEY="$(grep '^ENCRYPTION_KEY=' "${APP_DIR}/.env" | cut -d= -f2- || echo "${ENCRYPTION_KEY}")"
    INTERNAL_TOKEN="$(grep '^INTERNAL_TOKEN=' "${APP_DIR}/.env" | cut -d= -f2- || echo "${INTERNAL_TOKEN}")"
  fi

  cat > "${APP_DIR}/.env" <<EOF
APP_NAME=WaCalls
APP_ENV=production
APP_URL=https://${DOMAIN}
LOG_LEVEL=info
DOMAIN=${DOMAIN}
API_DOMAIN=${DOMAIN}
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=wacalls
POSTGRES_USER=wacalls
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://wacalls:${POSTGRES_PASSWORD}@postgres:5432/wacalls?schema=public
REDIS_URL=redis://redis:6379
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_TTL=12h
JWT_REFRESH_TTL=30d
ENCRYPTION_KEY=${ENCRYPTION_KEY}
INTERNAL_TOKEN=${INTERNAL_TOKEN}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=WaCalls <noreply@${DOMAIN}>
AI_PROVIDER=
AI_API_KEY=
CALLING_ENGINE=selfhosted
WEB_PORT=3000
API_PORT=3001
WHATSAPP_PORT=4010
SESSION_DIR=/data/sessions
RECORDINGS_DIR=/data/recordings
CORS_ORIGINS=https://${DOMAIN}
BACKUP_RETENTION_DAYS=7
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_ORG_NAME=${ORG_NAME}
LE_EMAIL=${LE_EMAIL}
EOF
  chmod 600 "${APP_DIR}/.env"
}

configure_firewall() {
  chmod +x "${APP_DIR}/scripts/open-ports.sh"
  "${APP_DIR}/scripts/open-ports.sh" || {
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 443/udp
    ufw allow 3478/udp
    ufw allow 3478/tcp
    ufw allow 3480/udp
    ufw allow 3480/tcp
    ufw allow 10000:10031/udp
    ufw --force enable
  }
  systemctl enable --now fail2ban
}

configure_ssl() {
  chmod +x "${APP_DIR}/scripts/enable-ssl.sh"
  if ! "${APP_DIR}/scripts/enable-ssl.sh"; then
    yellow "SSL not fully activated. HTTP may still work. Later run: ${APP_DIR}/scripts/enable-ssl.sh"
    echo "Pending (HTTP only)" > /tmp/wacalls-ssl-status
  fi
}

install_cli() {
  cat > /usr/local/bin/wacalls <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"
cmd="${1:-help}"
shift || true
case "${cmd}" in
  status) docker compose ps ;;
  logs) docker compose logs -f --tail=200 "$@" ;;
  restart) docker compose restart "$@" ;;
  update) sudo "${APP_DIR}/scripts/update.sh" ;;
  backup) sudo "${APP_DIR}/scripts/backup.sh" ;;
  health) curl -fsS "http://127.0.0.1/health" || curl -fsS "https://127.0.0.1/health" -k ;;
  ssl) sudo "${APP_DIR}/scripts/enable-ssl.sh" ;;
  *) echo "Usage: wacalls status|logs|restart|update|backup|health|ssl" ;;
esac
EOF
  chmod +x /usr/local/bin/wacalls
}

start_stack() {
  cd "${APP_DIR}"
  docker compose build
  docker compose up -d postgres redis
  echo "Waiting for database..."
  sleep 8
  docker compose up -d api worker whatsapp web nginx
  sleep 8
  docker compose exec -T api sh -c 'cd /app && pnpm --filter @wacalls/database migrate' || \
    docker compose exec -T api sh -c 'cd /app/packages/database && npx prisma migrate deploy'
  # shellcheck source=/dev/null
  . "${APP_DIR}/.env"
  docker compose exec -T \
    -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    -e ADMIN_ORG_NAME="${ADMIN_ORG_NAME}" \
    api sh -c 'cd /app && pnpm --filter @wacalls/database seed' || \
    docker compose exec -T \
      -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
      -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
      -e ADMIN_ORG_NAME="${ADMIN_ORG_NAME}" \
      api sh -c 'cd /app/packages/database && npx tsx src/seed.ts'
  unset ADMIN_PASSWORD
  sed -i '/^ADMIN_PASSWORD=/d' "${APP_DIR}/.env"
  echo "Waiting for HTTP health..."
  for _ in $(seq 1 20); do
    curl -fsS --max-time 5 http://127.0.0.1/health >/dev/null && break
    sleep 3
  done
}

cron_backup() {
  (crontab -l 2>/dev/null | grep -v wacalls-backup; echo "15 2 * * * ${APP_DIR}/scripts/backup.sh >/var/log/wacalls-backup.log 2>&1") | crontab -
}

print_done() {
  # shellcheck source=/dev/null
  . "${APP_DIR}/.env"
  local ssl
  ssl="$(cat /tmp/wacalls-ssl-status 2>/dev/null || echo Pending)"
  cat <<EOF

========================================
       WaCalls Installation Complete
========================================

Application:
https://${DOMAIN}

Admin:
https://${DOMAIN}/login

API:
https://${DOMAIN}/api

Health:
https://${DOMAIN}/health

Docker:
Running

PostgreSQL:
Running

Redis:
Running

WhatsApp:
Ready for QR connection

SSL:
${ssl}

Firewall:
Enabled
========================================

Commands: wacalls status | logs | restart | update | backup | health | ssl
EOF
}

main() {
  require_root
  check_os
  check_resources
  install_packages
  install_docker
  copy_app
  prompt_config
  configure_firewall
  start_stack
  configure_ssl || true
  install_cli
  cron_backup
  print_done
}

main "$@"
