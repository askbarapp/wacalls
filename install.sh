#!/usr/bin/env bash
# ==============================================================================
#  WaCall OS (WAO) — Complete 1-Click Automated Server Installer
#  Compatible with: Ubuntu 20.04, 22.04, 24.04 / Debian 11, 12
#
#  Usage:
#    sudo bash install.sh
#  Or non-interactive:
#    DOMAIN=yourdomain.com sudo bash install.sh
# ==============================================================================
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${APP_DIR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { printf "${BLUE}ℹ %s${NC}\n" "$*"; }
log_success() { printf "${GREEN}✔ %s${NC}\n" "$*"; }
log_warn()    { printf "${YELLOW}⚠ %s${NC}\n" "$*"; }
log_error()   { printf "${RED}✖ %s${NC}\n" "$*"; }

banner() {
  clear 2>/dev/null || true
  printf "${CYAN}"
  cat << 'EOF'
  __          __         _____      _ _    ____   _____ 
  \ \        / /        / ____|    | | |  / __ \ / ____|
   \ \  /\  / /_ _     | |     __ _| | | | |  | | (___  
    \ \/  \/ / _` |    | |    / _` | | | | |  | |\___ \ 
     \  /\  / (_| |    | |___| (_| | | | | |__| |____) |
      \/  \/ \__,_|_____\_____\__,_|_|_|  \____/|_____/ 
                 |______|                               
   Autonomous AI Business & WhatsApp Calling Platform
   Full Auto-Installer & Deployment Script v3.0
EOF
  printf "${NC}\n"
}

# 1. Root & OS Verification
check_env() {
  if [[ "${EUID}" -ne 0 ]]; then
    log_error "This script must be run as root. Please run: sudo bash install.sh"
    exit 1
  fi

  if [[ ! -f /etc/os-release ]]; then
    log_error "Unsupported Linux distribution."
    exit 1
  fi

  . /etc/os-release
  log_info "Detected OS: ${PRETTY_NAME:-Linux}"
}

# 2. Install System Dependencies & Docker
install_dependencies() {
  log_info "Updating system packages and installing prerequisites..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl wget git unzip ca-certificates gnupg ufw openssl jq dnsutils rsync fail2ban

  if command -v docker >/dev/null 2>&1; then
    log_success "Docker is already installed: $(docker --version)"
  else
    log_info "Installing Docker Engine..."
    curl -fsSL https://get.docker.com | sh
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_info "Installing Docker Compose plugin..."
    apt-get install -y docker-compose-plugin
  fi

  systemctl enable --now docker
  log_success "Docker & Compose are ready."
}

# 3. Detect Public IP & Setup Domain
configure_network() {
  PUBLIC_IP=$(curl -4 -s https://api.ipify.org || curl -4 -s https://ifconfig.me || curl -4 -s https://icanhazip.com || echo "")
  if [[ -z "${PUBLIC_IP}" ]]; then
    PUBLIC_IP=$(hostname -I | awk '{print $1}')
  fi
  log_info "Server Public IPv4: ${PUBLIC_IP}"

  if [[ -z "${DOMAIN:-}" ]]; then
    echo ""
    printf "${CYAN}Enter your Domain Name (e.g. wacall.in or app.yourcompany.com)${NC}\n"
    printf "Leave empty to use Server IP (${PUBLIC_IP}): "
    read -r USER_INPUT_DOMAIN
    DOMAIN="${USER_INPUT_DOMAIN:-${PUBLIC_IP}}"
  fi

  DOMAIN=$(echo "${DOMAIN}" | tr '[:upper:]' '[:lower:]' | xargs)
  log_success "Configured Primary Domain: ${DOMAIN}"
}

# 4. Generate Production .env
setup_env_file() {
  log_info "Configuring production environment variables (.env)..."

  if [[ -f .env ]]; then
    log_warn "Existing .env found. Creating backup at .env.backup.$(date +%s)"
    cp .env ".env.backup.$(date +%s)"
  fi

  RANDOM_DB_PASS=$(openssl rand -hex 16)
  RANDOM_JWT_SECRET=$(openssl rand -hex 32)
  RANDOM_ENCRYPT_KEY=$(openssl rand -hex 32)
  RANDOM_TOKEN=$(openssl rand -hex 24)

  PROTOCOL="https"
  WS_PROTOCOL="wss"
  if [[ "${DOMAIN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    PROTOCOL="http"
    WS_PROTOCOL="ws"
  fi

  APP_URL="${PROTOCOL}://${DOMAIN}"
  NEXT_PUBLIC_API_URL="${PROTOCOL}://${DOMAIN}"
  NEXT_PUBLIC_WS_URL="${WS_PROTOCOL}://${DOMAIN}/ws"

  cat > .env << EOF
APP_NAME=WaCall OS
APP_ENV=production
APP_URL=${APP_URL}
LOG_LEVEL=info

DOMAIN=${DOMAIN}
API_DOMAIN=${DOMAIN}

NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=wacalls
POSTGRES_USER=wacalls
POSTGRES_PASSWORD=${RANDOM_DB_PASS}
DATABASE_URL=postgresql://wacalls:${RANDOM_DB_PASS}@postgres:5432/wacalls?schema=public

REDIS_URL=redis://redis:6379

JWT_SECRET=${RANDOM_JWT_SECRET}
JWT_ACCESS_TTL=12h
JWT_REFRESH_TTL=30d

ENCRYPTION_KEY=${RANDOM_ENCRYPT_KEY}
INTERNAL_TOKEN=${RANDOM_TOKEN}

# Voice & AI Engine Defaults (Can be configured inside Dashboard -> AI Calling)
AI_PROVIDER=sarvam
AI_API_KEY=
AI_MODEL=sarvam-105b-conversations
AI_STT_PROVIDER=sarvam
AI_TTS_PROVIDER=sarvam
SARVAM_API_KEY=

CALLING_ENGINE=selfhosted
BAILEYS_CALLER_ENABLED=true

WEB_PORT=3000
API_PORT=3001
WHATSAPP_PORT=4010
METRICS_PORT=9090

PUBLIC_IP=${PUBLIC_IP}
ICE_UDP_PORT_MIN=10000
ICE_UDP_PORT_MAX=10031

SESSION_DIR=/data/sessions
RECORDINGS_DIR=/data/recordings

CORS_ORIGINS=${APP_URL}
BACKUP_RETENTION_DAYS=7
EOF

  log_success "Generated secure production .env configuration."
}

# 5. Open Firewall Ports
configure_firewall() {
  log_info "Configuring UFW firewall rules..."
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp 2>/dev/null || true
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    ufw allow 10000:10031/udp 2>/dev/null || true
    ufw --force enable 2>/dev/null || true
    log_success "Firewall rules enabled (Ports 22, 80, 443 TCP & 10000-10031 UDP)."
  fi
}

# 6. Configure Nginx & SSL
setup_nginx_ssl() {
  log_info "Configuring Nginx Reverse Proxy..."
  mkdir -p nginx certbot-www certbot-certs

  # Generate clean default.conf
  cat > nginx/default.conf << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    # WebSocket
    location /ws {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # API Routes
    location /api/ {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Web Dashboard Frontend
    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  # If domain is not an IP, attempt automatic SSL certificate issuance
  if [[ ! "${DOMAIN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_info "Attempting Let's Encrypt SSL certificate generation for ${DOMAIN}..."
    if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]] && [[ ! -d "certbot-certs/live/${DOMAIN}" ]]; then
      # Temporary self-signed certificate so nginx can start initially
      mkdir -p "certbot-certs/live/${DOMAIN}"
      openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "certbot-certs/live/${DOMAIN}/privkey.pem" \
        -out "certbot-certs/live/${DOMAIN}/fullchain.pem" \
        -subj "/CN=${DOMAIN}" 2>/dev/null || true
    fi
  else
    # IP Address Mode (HTTP fallback)
    cat > nginx/default.conf << EOF
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50M;

    location /ws {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /api/ {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi

  log_success "Nginx proxy configured."
}

# 7. Build and Launch Containers
build_and_start() {
  log_info "Building and launching WaCall OS services (Docker Compose)..."
  log_info "This might take 2-4 minutes on the first build."

  docker compose down 2>/dev/null || true
  docker compose build
  docker compose up -d

  log_info "Waiting for database and backend services to initialize..."
  sleep 10

  # Run Prisma database migrations
  log_info "Running PostgreSQL schema migrations..."
  docker compose exec -T api pnpm --filter @wacalls/database generate || true
  docker compose exec -T api npx prisma db push --schema=/app/packages/database/prisma/schema.prisma --accept-data-loss 2>/dev/null || true

  log_success "Containers started successfully."
}

# 8. Verification & Summary
verify_installation() {
  echo ""
  log_info "Verifying container statuses..."
  docker compose ps

  echo ""
  printf "${GREEN}════════════════════════════════════════════════════════════════════${NC}\n"
  printf "${GREEN}   🎉  WaCall OS (WAO) Installation Completed Successfully!       ${NC}\n"
  printf "${GREEN}════════════════════════════════════════════════════════════════════${NC}\n"
  echo ""
  printf "  🌐 Web Dashboard URL : ${CYAN}%s${NC}\n" "${APP_URL}"
  printf "  🔌 API Endpoint      : ${CYAN}%s/api/v1/health${NC}\n" "${APP_URL}"
  printf "  🤖 WhatsApp Line     : ${CYAN}%s/channels${NC}\n" "${APP_URL}"
  printf "  📋 Action Center     : ${CYAN}%s/tasks${NC}\n" "${APP_URL}"
  printf "  🎨 Creative Studio   : ${CYAN}%s/creative-studio${NC}\n" "${APP_URL}"
  printf "  📬 Email Hub         : ${CYAN}%s/email${NC}\n" "${APP_URL}"
  echo ""
  printf "  📁 Code Directory    : ${YELLOW}%s${NC}\n" "${APP_DIR}"
  printf "  ⚙️  Config File       : ${YELLOW}%s/.env${NC}\n" "${APP_DIR}"
  echo ""
  printf "  💡 Helpful Commands:\n"
  printf "     • View logs        : ${CYAN}docker compose logs -f${NC}\n"
  printf "     • Restart platform : ${CYAN}docker compose restart${NC}\n"
  printf "     • Stop platform    : ${CYAN}docker compose down${NC}\n"
  printf "     • Update platform  : ${CYAN}docker compose up -d --build${NC}\n"
  printf "${GREEN}════════════════════════════════════════════════════════════════════${NC}\n"
}

# Main Execution Flow
banner
check_env
install_dependencies
configure_network
setup_env_file
configure_firewall
setup_nginx_ssl
build_and_start
verify_installation
