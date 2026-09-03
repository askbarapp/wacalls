#!/usr/bin/env bash
# Open every port WaCalls needs on Ubuntu UFW (and print hosting-panel list).
# Usage: sudo /opt/wacalls/scripts/open-ports.sh
set -uo pipefail

green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
command -v ufw >/dev/null 2>&1 || apt-get install -y -qq ufw >/dev/null

# Docker + WebRTC need forwarding
sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null \
  || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

ufw default deny incoming
ufw default allow outgoing

# App / TLS
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP / ACME'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3 + TURN over UDP'

# WhatsApp media: STUN / TURN / ICE (Meta relays — also allow inbound return)
ufw allow 3478/udp comment 'WhatsApp STUN/TURN'
ufw allow 3478/tcp comment 'WhatsApp TURN TCP'
ufw allow 3480/udp comment 'WhatsApp ICE/media relay'
ufw allow 3480/tcp comment 'WhatsApp ICE TCP'

# Local ICE/RTP range published by the WhatsApp bridge container
ufw allow 10000:10031/udp comment 'WebRTC ICE/RTP'

# Explicit outbound (in case default outgoing is later denied)
ufw allow out 53 comment 'DNS'
ufw allow out 80/tcp
ufw allow out 443/tcp
ufw allow out 443/udp
ufw allow out 3478/udp
ufw allow out 3478/tcp
ufw allow out 3480/udp
ufw allow out 3480/tcp
ufw allow out 10000:10031/udp
ufw allow out 4010/tcp comment 'WhatsApp bridge (internal, extra)'

# Established replies (UFW before.rules already has this; keep extra safety)
ufw allow in on docker0 >/dev/null 2>&1 || true
echo 'y' | ufw enable >/dev/null
ufw reload >/dev/null || true

green "✔ UFW ports open for WaCalls"
echo ""
yellow "Also open the SAME ports on your VPS hosting panel (Hostinger/etc), or calls will fail:"
cat <<'EOF'
  TCP  22
  TCP  80
  TCP  443
  UDP  443
  UDP  3478
  TCP  3478
  UDP  3480
  TCP  3480
  UDP  10000-10031
EOF
echo ""
ufw status numbered | head -40
