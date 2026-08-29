#!/usr/bin/env bash
# Issue / activate Let's Encrypt HTTPS for an already-running WaCalls stack.
# Usage (root):  /opt/wacalls/scripts/enable-ssl.sh
set -euo pipefail

APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  set -a
  . ./.env
  set +a
fi

DOMAIN="${DOMAIN:-}"
LE_EMAIL="${LE_EMAIL:-${ADMIN_EMAIL:-admin@${DOMAIN}}}"

if [[ -z "${DOMAIN}" ]]; then
  echo "DOMAIN is not set. Add DOMAIN=wacall.in to ${APP_DIR}/.env"
  exit 1
fi

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

mkdir -p "${APP_DIR}/certbot-www" "${APP_DIR}/certbot-certs"

echo "==> 1. HTTP health"
HTTP_OK=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 http://127.0.0.1/health >/dev/null; then
    HTTP_OK=1
    break
  fi
  sleep 3
done
if [[ "${HTTP_OK}" -ne 1 ]]; then
  red "http://127.0.0.1/health failed. Start the stack first: cd ${APP_DIR} && docker compose up -d"
  exit 1
fi
green "HTTP health ok"

echo "==> 2. Ports 80/443"
if ! ss -tlnp | grep -q ':80 '; then
  yellow "Nothing listening on :80 yet (nginx may still be binding)."
fi
if ! ss -tlnp | grep -q ':443 '; then
  yellow "Nothing listening on :443 yet (expected until SSL is enabled)."
fi

echo "==> 3. DNS"
SERVER_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me || hostname -I | awk '{print $1}')"
APEX_IP="$(getent ahostsv4 "${DOMAIN}" | awk '{print $1; exit}')"
echo "Server IP: ${SERVER_IP}"
echo "${DOMAIN} -> ${APEX_IP:-unresolved}"
if [[ -n "${APEX_IP}" && -n "${SERVER_IP}" && "${APEX_IP}" != "${SERVER_IP}" ]]; then
  yellow "DNS for ${DOMAIN} is ${APEX_IP}, this VPS is ${SERVER_IP}. Certbot may fail until they match."
fi

CERT_ARGS=(-d "${DOMAIN}")
WWW_IP="$(getent ahostsv4 "www.${DOMAIN}" | awk '{print $1; exit}' || true)"
if [[ -n "${WWW_IP}" ]]; then
  echo "www.${DOMAIN} -> ${WWW_IP}"
  CERT_ARGS+=(-d "www.${DOMAIN}")
fi

echo "==> 4. Ensure HTTP nginx (ACME challenge) is live"
docker compose up -d nginx
sleep 2

echo "==> 5. Request Let's Encrypt certificate"
if [[ ! -f "${APP_DIR}/certbot-certs/live/${DOMAIN}/fullchain.pem" ]]; then
  docker run --rm \
    -v "${APP_DIR}/certbot-www:/var/www/certbot" \
    -v "${APP_DIR}/certbot-certs:/etc/letsencrypt" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    "${CERT_ARGS[@]}" \
    --email "${LE_EMAIL}" --agree-tos --no-eff-email --non-interactive
else
  green "Certificate already exists for ${DOMAIN}"
fi

if [[ ! -f "${APP_DIR}/certbot-certs/live/${DOMAIN}/fullchain.pem" ]] || \
   [[ ! -f "${APP_DIR}/certbot-certs/live/${DOMAIN}/privkey.pem" ]]; then
  red "Certificate files missing under ${APP_DIR}/certbot-certs/live/${DOMAIN}/"
  echo "Pending (HTTP only)" > /tmp/wacalls-ssl-status
  exit 1
fi
green "Certificate files present"

echo "==> 6. Write nginx SSL config from template"
sed "s/\${DOMAIN}/${DOMAIN}/g" "${APP_DIR}/nginx/ssl.conf.tpl" > "${APP_DIR}/nginx/default.conf"

echo "==> 7. nginx -t"
if ! docker compose exec -T nginx nginx -t; then
  red "nginx -t failed; restoring HTTP-only config from nginx/http.conf"
  if [[ -f "${APP_DIR}/nginx/http.conf" ]]; then
    cp "${APP_DIR}/nginx/http.conf" "${APP_DIR}/nginx/default.conf"
    docker compose exec -T nginx nginx -s reload || true
  fi
  exit 1
fi

echo "==> 8. Reload nginx"
docker compose exec -T nginx nginx -s reload || docker compose restart nginx
sleep 2

echo "==> 9. Verify HTTPS"
HTTPS_OK=0
if curl -fsS --max-time 15 "https://${DOMAIN}/health" >/dev/null; then
  green "https://${DOMAIN}/health ok"
  HTTPS_OK=1
else
  yellow "External https://${DOMAIN}/health failed; trying local TLS"
  curl -kfsS --max-time 8 https://127.0.0.1/health && HTTPS_OK=1 || true
fi
if curl -fsS -o /dev/null --max-time 15 -w "%{http_code}" "https://${DOMAIN}/login" | grep -qE '200|307|308'; then
  green "https://${DOMAIN}/login reachable"
fi

echo "==> 10. Automatic renewal"
(crontab -l 2>/dev/null | grep -v wacalls-certbot || true
  echo "0 3 * * * docker run --rm -v ${APP_DIR}/certbot-certs:/etc/letsencrypt -v ${APP_DIR}/certbot-www:/var/www/certbot certbot/certbot renew --quiet && docker compose -f ${APP_DIR}/docker-compose.yml exec -T nginx nginx -s reload"
) | crontab -

if [[ "${HTTPS_OK}" -eq 1 ]]; then
  echo "Enabled" > /tmp/wacalls-ssl-status
  green "HTTPS enabled for ${DOMAIN}"
else
  echo "Certificate issued; verify firewall 443 and DNS" > /tmp/wacalls-ssl-status
  yellow "Certificate is on disk and nginx has 443. If the browser still fails, open 443 on the hosting panel firewall."
fi
