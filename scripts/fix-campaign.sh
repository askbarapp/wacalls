#!/usr/bin/env bash
# Diagnose / unstick a frozen RUNNING campaign on VPS.
# Usage: sudo bash /opt/wacalls/scripts/fix-campaign.sh [campaignId]
set -euo pipefail
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"

echo "==> Container status"
docker compose ps

echo ""
echo "==> Worker logs (last 60)"
docker compose logs --tail=60 worker || true

echo ""
echo "==> Redis ping"
docker compose exec -T redis redis-cli ping || true

echo ""
echo "==> Connected WhatsApp channels"
docker compose exec -T postgres psql -U wacalls -d wacalls -c \
  "SELECT id, display_name, status, provider, phone_number FROM whatsapp_channels ORDER BY updated_at DESC LIMIT 10;" || true

echo ""
echo "==> Running campaigns with pending contacts"
docker compose exec -T postgres psql -U wacalls -d wacalls -c \
  "SELECT c.id, c.name, c.status, c.type,
          (SELECT count(*) FROM campaign_contacts cc WHERE cc.campaign_id=c.id AND cc.status IN ('pending','retry')) AS pending,
          (SELECT count(*) FROM calls cl WHERE cl.campaign_id=c.id) AS calls
   FROM campaigns c
   WHERE c.status='RUNNING'
   ORDER BY c.updated_at DESC
   LIMIT 10;" || true

echo ""
echo "==> Restarting worker (re-attaches to BullMQ queues)"
docker compose up -d worker
docker compose restart worker
sleep 3

if [[ -n "${1:-}" ]]; then
  CID="$1"
  echo "==> Resetting stuck 'calling' contacts for $CID → pending"
  docker compose exec -T postgres psql -U wacalls -d wacalls -c \
    "UPDATE campaign_contacts SET status='pending', next_attempt_at=NOW()
     WHERE campaign_id='$CID' AND status='calling' AND skipped=false;"
  echo "Now open the campaign page and tap Resume dialing / Start again."
else
  echo "Tip: pass campaign id to reset stuck contacts:"
  echo "  sudo bash $0 9477f3dd-a4ec-4943-a16e-a167328ef28d"
fi

echo ""
echo "Then in UI: Campaign → Resume dialing (or Pause → Start)."
