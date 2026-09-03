#!/usr/bin/env bash
# ============================================================
#  WaCalls — One-line installer
#  Usage:
#    bash <(curl -fsSL https://raw.githubusercontent.com/askbarapp/wacalls/main/scripts/install.sh)
#
#  Or with a domain pre-set:
#    DOMAIN=wacall.in bash <(curl -fsSL https://raw.githubusercontent.com/askbarapp/wacalls/main/scripts/install.sh)
# ============================================================
set -euo pipefail

APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
REPO="${WACALLS_REPO:-https://github.com/askbarapp/wacalls.git}"
MIN_CPU=2
MIN_RAM_KB=$((3500 * 1024))
MIN_DISK_KB=$((25 * 1024 * 1024))

# ── colours ─────────────────────────────────────────────────
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
blue()   { printf "\033[34m%s\033[0m\n" "$*"; }

banner() {
  echo ""
  blue "╔══════════════════════════════════════════════╗"
  blue "║          WaCalls Installer v2.0              ║"
  blue "║   WhatsApp Calling & AI Platform             ║"
  blue "╚══════════════════════════════════════════════╝"
  echo ""
}

# ── preflight ───────────────────────────────────────────────
require_root() {
  [[ "${EUID}" -eq 0 ]] || { red "Run as root: sudo bash install.sh"; exit 1; }
}

check_os() {
  [[ -f /etc/os-release ]] || { red "Unsupported OS"; exit 1; }
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID}" == "ubuntu" ]] || { red "Ubuntu 22.04 / 24.04 required (found ${ID})"; exit 1; }
  case "${VERSION_ID}" in
    22.04|24.04) green "✔ OS: Ubuntu ${VERSION_ID}" ;;
    *) yellow "Ubuntu ${VERSION_ID} is untested — continuing anyway." ;;
  esac
}

check_resources() {
  local cpus ram disk
  cpus="$(nproc)"
  ram="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
  disk="$(df -k / | awk 'NR==2{print $4}')"
  echo "  CPU: ${cpus} cores   RAM: $((ram/1024)) MB   Free disk: $((disk/1024/1024)) GB"
  (( cpus  < MIN_CPU     )) && yellow "⚠  Recommended: ${MIN_CPU}+ CPU cores"
  (( ram   < MIN_RAM_KB  )) && yellow "⚠  Recommended: 4 GB+ RAM"
  (( disk  < MIN_DISK_KB )) && yellow "⚠  Recommended: 25 GB+ free disk"
}

# ── deps ─────────────────────────────────────────────────────
install_packages() {
  green "→ Installing system packages…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y -qq
  apt-get install -y -qq \
    curl git wget unzip ca-certificates gnupg ufw fail2ban \
    openssl jq dnsutils rsync
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    green "✔ Docker already installed ($(docker --version | head -1))"
  else
    green "→ Installing Docker…"
    curl -fsSL https://get.docker.com | sh
  fi
  if ! docker compose version >/dev/null 2>&1; then
    apt-get install -y -qq docker-compose-plugin
  fi
  systemctl enable --now docker
  green "✔ Docker $(docker --version | grep -oP '[\d.]+ '| head -1)ready"
}

# ── clone / update repo ──────────────────────────────────────
clone_repo() {
  if [[ -d "${APP_DIR}/.git" ]]; then
    green "→ Updating existing install at ${APP_DIR}…"
    cd "${APP_DIR}"
    git checkout -- nginx/default.conf 2>/dev/null || true
    git pull --ff-only
  else
    green "→ Cloning WaCalls into ${APP_DIR}…"
    git clone "${REPO}" "${APP_DIR}"
  fi
  green "✔ Code ready at ${APP_DIR}"
}

# ── interactive config ───────────────────────────────────────
read_tty() {
  local prompt="$1" var="$2" silent="${3:-}"
  if [[ -n "${silent}" ]]; then
    if [[ -e /dev/tty ]]; then read -r -s -p "${prompt}" "${var}" </dev/tty; echo >/dev/tty
    else read -r -s -p "${prompt}" "${var}"; echo; fi
  else
    if [[ -e /dev/tty ]]; then read -r -p "${prompt}" "${var}" </dev/tty
    else read -r -p "${prompt}" "${var}"; fi
  fi
}

prompt_config() {
  echo ""
  blue "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  blue "          Installation Configuration"
  blue "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Domain
  if [[ -z "${DOMAIN:-}" ]]; then
    read_tty "  Domain (e.g. wacall.in): " DOMAIN
  else
    green "  Domain: ${DOMAIN} (from env)"
  fi
  [[ -n "${DOMAIN}" ]] || { red "Domain is required"; exit 1; }

  # Admin email
  read_tty "  Admin email: " ADMIN_EMAIL
  [[ -n "${ADMIN_EMAIL}" ]] || { red "Email is required"; exit 1; }

  # Admin password
  local pw1 pw2
  read_tty "  Admin password (min 10 chars): " pw1 silent
  read_tty "  Confirm password: " pw2 silent
  [[ "${pw1}" == "${pw2}" ]]  || { red "Passwords do not match"; exit 1; }
  [[ ${#pw1} -ge 10 ]]        || { red "Password must be at least 10 characters"; exit 1; }
  ADMIN_PASSWORD="${pw1}"

  # Org name
  read_tty "  Organisation name [WaCalls]: " ORG_NAME
  ORG_NAME="${ORG_NAME:-WaCalls}"

  # Let's Encrypt email
  read_tty "  Let's Encrypt email [${ADMIN_EMAIL}]: " LE_EMAIL
  LE_EMAIL="${LE_EMAIL:-${ADMIN_EMAIL}}"

  # Sarvam API key (optional)
  read_tty "  Sarvam AI API key (optional, press Enter to skip): " SARVAM_API_KEY
  SARVAM_API_KEY="${SARVAM_API_KEY:-}"

  # DNS reminder
  SERVER_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  echo ""
  yellow "  ┌─────────────────────────────────────────────┐"
  yellow "  │  Point these DNS A records to ${SERVER_IP}"
  yellow "  │                                             │"
  yellow "  │  A   ${DOMAIN}       →  ${SERVER_IP}"
  yellow "  │  A   www.${DOMAIN}   →  ${SERVER_IP}"
  yellow "  └─────────────────────────────────────────────┘"
  echo ""
  read_tty "  Press Enter once DNS is set (or Enter to skip SSL and do it later)…" _

  # Generate secrets (keep existing if upgrading)
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  if [[ -f "${APP_DIR}/.env" ]] && grep -q '^POSTGRES_PASSWORD=' "${APP_DIR}/.env"; then
    yellow "  Keeping existing POSTGRES_PASSWORD from previous install."
    POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' "${APP_DIR}/.env" | cut -d= -f2-)"
  fi

  JWT_SECRET="$(openssl rand -hex 48)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  INTERNAL_TOKEN="$(openssl rand -hex 32)"
  if [[ -f "${APP_DIR}/.env" ]]; then
    JWT_SECRET="$(       grep '^JWT_SECRET='       "${APP_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "${JWT_SECRET}")"
    ENCRYPTION_KEY="$(   grep '^ENCRYPTION_KEY='   "${APP_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "${ENCRYPTION_KEY}")"
    INTERNAL_TOKEN="$(   grep '^INTERNAL_TOKEN='   "${APP_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "${INTERNAL_TOKEN}")"
  fi

  # Write .env
  cat > "${APP_DIR}/.env" <<EOF
# ── App ──────────────────────────────────────────
APP_NAME=WaCalls
APP_ENV=production
APP_URL=https://${DOMAIN}
LOG_LEVEL=info
DOMAIN=${DOMAIN}
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=

# ── Database ─────────────────────────────────────
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=wacalls
POSTGRES_USER=wacalls
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://wacalls:${POSTGRES_PASSWORD}@postgres:5432/wacalls?schema=public

# ── Redis ────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── Security ─────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_TTL=12h
JWT_REFRESH_TTL=30d
ENCRYPTION_KEY=${ENCRYPTION_KEY}
INTERNAL_TOKEN=${INTERNAL_TOKEN}

# ── Email (SMTP) — fill in to send emails ────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=WaCalls <noreply@${DOMAIN}>

# ── AI (Sarvam) ──────────────────────────────────
SARVAM_API_KEY=${SARVAM_API_KEY}
AI_PROVIDER=
AI_API_KEY=

# ── Calling engine ───────────────────────────────
CALLING_ENGINE=selfhosted

# ── Ports (internal) ─────────────────────────────
WEB_PORT=3000
API_PORT=3001
WHATSAPP_PORT=4010

# ── Storage ──────────────────────────────────────
SESSION_DIR=/data/sessions
RECORDINGS_DIR=/data/recordings

# ── CORS ─────────────────────────────────────────
CORS_ORIGINS=https://${DOMAIN}

# ── Backups ──────────────────────────────────────
BACKUP_RETENTION_DAYS=7

# ── Seed (removed after first run) ───────────────
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_ORG_NAME=${ORG_NAME}
LE_EMAIL=${LE_EMAIL}
EOF
  chmod 600 "${APP_DIR}/.env"
  green "✔ .env written"
}

# ── firewall ────────────────────────────────────────────────
configure_firewall() {
  green "→ Configuring firewall (ufw)…"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment "SSH"
  ufw allow 80/tcp comment "HTTP"
  ufw allow 443/tcp comment "HTTPS"
  ufw --force enable
  systemctl enable --now fail2ban 2>/dev/null || true
  green "✔ Firewall enabled (22, 80, 443)"
}

# ── start stack ─────────────────────────────────────────────
start_stack() {
  cd "${APP_DIR}"
  green "→ Building Docker images (this takes 10–15 min the first time)…"
  docker compose build --progress=plain 2>&1 | tail -5

  green "→ Starting postgres + redis…"
  docker compose up -d postgres redis
  echo "  Waiting for database to be ready…"
  sleep 10

  green "→ Starting api, worker, whatsapp, web, nginx…"
  docker compose up -d api worker whatsapp web nginx
  sleep 10

  green "→ Running database migrations…"
  docker compose exec -T api sh -c \
    'cd /app && pnpm --filter @wacalls/database migrate 2>/dev/null || \
     npx prisma migrate deploy --schema /app/packages/database/prisma/schema.prisma' \
  || docker compose exec -T api sh -c \
    'cd /app/packages/database && npx prisma migrate deploy'

  green "→ Seeding admin user…"
  # shellcheck source=/dev/null
  set -a; . "${APP_DIR}/.env"; set +a
  docker compose exec -T \
    -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    -e ADMIN_ORG_NAME="${ADMIN_ORG_NAME}" \
    api sh -c 'cd /app && pnpm --filter @wacalls/database seed 2>/dev/null || \
               npx tsx /app/packages/database/src/seed.ts' \
  || docker compose exec -T \
    -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    -e ADMIN_ORG_NAME="${ADMIN_ORG_NAME}" \
    api sh -c 'cd /app/packages/database && npx tsx src/seed.ts'

  # Remove password from .env for security
  sed -i '/^ADMIN_PASSWORD=/d' "${APP_DIR}/.env"
  unset ADMIN_PASSWORD

  green "→ Waiting for HTTP health check…"
  local ok=0
  for _ in $(seq 1 24); do
    curl -fsS --max-time 5 http://127.0.0.1/health >/dev/null 2>&1 && ok=1 && break
    sleep 5
  done
  [[ "${ok}" -eq 1 ]] && green "✔ HTTP health check passed" \
                       || yellow "⚠ Health check pending — check logs if site doesn't load"
}

# ── SSL ─────────────────────────────────────────────────────
configure_ssl() {
  green "→ Requesting SSL certificate from Let's Encrypt…"
  chmod +x "${APP_DIR}/scripts/enable-ssl.sh"
  "${APP_DIR}/scripts/enable-ssl.sh" \
    && green "✔ HTTPS enabled" \
    || yellow "⚠ SSL pending — run later: wacalls ssl"
}

# ── wacalls CLI ─────────────────────────────────────────────
install_cli() {
  cat > /usr/local/bin/wacalls <<CLIEOF
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR}"
cd "\${APP_DIR}"
cmd="\${1:-help}"
shift || true
case "\${cmd}" in
  status)  docker compose ps ;;
  logs)    docker compose logs -f --tail=200 "\$@" ;;
  restart) docker compose restart "\$@" ;;
  update)  sudo "\${APP_DIR}/scripts/update.sh" ;;
  backup)  sudo "\${APP_DIR}/scripts/backup.sh" ;;
  ssl)     sudo "\${APP_DIR}/scripts/enable-ssl.sh" ;;
  health)  curl -fsS "https://\$(grep '^DOMAIN=' \${APP_DIR}/.env | cut -d= -f2)/health" || curl -kfsS https://127.0.0.1/health ;;
  shell)   docker compose exec "\${1:-api}" sh ;;
  *) echo "Usage: wacalls  status | logs [service] | restart [service] | update | backup | ssl | health | shell [service]" ;;
esac
CLIEOF
  chmod +x /usr/local/bin/wacalls
  green "✔ CLI installed — type: wacalls status"
}

# ── auto-backup cron ─────────────────────────────────────────
setup_cron() {
  (crontab -l 2>/dev/null | grep -v wacalls-backup; \
   echo "15 2 * * * ${APP_DIR}/scripts/backup.sh >>/var/log/wacalls-backup.log 2>&1") \
  | crontab -
  green "✔ Daily backup cron set (2:15 AM)"
}

# ── done ─────────────────────────────────────────────────────
print_done() {
  # shellcheck source=/dev/null
  set -a; . "${APP_DIR}/.env"; set +a
  local ssl_status
  ssl_status="$(cat /tmp/wacalls-ssl-status 2>/dev/null || echo 'Pending (run: wacalls ssl)')"
  echo ""
  green "╔══════════════════════════════════════════════════════╗"
  green "║          ✅  WaCalls Installed Successfully          ║"
  green "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "  🌐  App URL    :  https://${DOMAIN}"
  echo "  🔑  Login      :  https://${DOMAIN}/login"
  echo "  👤  Admin      :  ${ADMIN_EMAIL}"
  echo "  🔒  SSL        :  ${ssl_status}"
  echo ""
  echo "  ── Useful commands ──────────────────────────────────"
  echo "  wacalls status          — container status"
  echo "  wacalls logs api        — API logs"
  echo "  wacalls logs worker     — worker / AI agent logs"
  echo "  wacalls update          — pull latest code & restart"
  echo "  wacalls ssl             — activate / renew HTTPS"
  echo "  wacalls backup          — manual backup"
  echo "  wacalls restart web     — restart one service"
  echo "  ─────────────────────────────────────────────────────"
  echo ""
  yellow "  Next: Open https://${DOMAIN}/login in your browser."
  yellow "        Connect a WhatsApp channel from the Channels page."
  echo ""
}

# ── main ────────────────────────────────────────────────────
main() {
  banner
  require_root
  check_os
  check_resources
  install_packages
  install_docker
  clone_repo
  prompt_config
  configure_firewall
  start_stack
  configure_ssl || true
  install_cli
  setup_cron
  print_done
}

main "$@"
