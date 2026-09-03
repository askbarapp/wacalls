#!/usr/bin/env bash
# Repair missing whatsmeow_* tables (WhatsApp pairing / QR store).
# Usage: sudo bash /opt/wacalls/scripts/repair-whatsmeow.sh
set -euo pipefail

APP_DIR="${WACALLS_DIR:-/opt/wacalls}"
cd "${APP_DIR}"

echo "==> Checking postgres + whatsapp containers"
docker compose up -d postgres whatsapp
sleep 3

echo "==> Current whatsmeow tables:"
docker compose exec -T postgres psql -U wacalls -d wacalls -c "\dt whatsmeow*" || true

echo "==> Resetting whatsmeow version marker (forces full schema recreate on restart)"
docker compose exec -T postgres psql -U wacalls -d wacalls <<'SQL'
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'whatsmeow_%'
  ) LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
SQL

echo "==> Pulling latest bridge + recreating whatsapp (runs Upgrade on boot)"
if [[ -d .git ]]; then
  git pull --ff-only || true
fi
docker compose up -d --build --force-recreate whatsapp
sleep 8

echo "==> WhatsApp logs (upgrade):"
docker compose logs --tail=40 whatsapp

echo "==> Tables after repair:"
docker compose exec -T postgres psql -U wacalls -d wacalls -c "\dt whatsmeow*"

if docker compose exec -T postgres psql -U wacalls -d wacalls -tAc \
  "SELECT 1 FROM information_schema.tables WHERE table_name='whatsmeow_device'" | grep -q 1; then
  echo ""
  echo "✔ whatsmeow_device is ready. Open Channels → New QR / Pairing code again."
else
  echo ""
  echo "✖ Table still missing. Paste: docker compose logs --tail=80 whatsapp"
  exit 1
fi
