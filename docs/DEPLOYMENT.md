# Deployment

## Docker Compose (production)

```bash
cp .env.example .env
# set secrets, domain, CALLING_ENGINE=selfhosted, APP_ENV=production
docker compose up -d --build
docker compose exec api sh -c 'cd /app && pnpm --filter @wacalls/database migrate'
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='…' api \
  sh -c 'cd /app && pnpm --filter @wacalls/database seed'
```

Volumes: `postgres_data`, `redis_data`, `whatsapp_sessions`, `recordings`.

Sessions must not live only in an ephemeral container filesystem.

## SSL

`scripts/setup.sh` issues Let's Encrypt after the stack is healthy, writes `nginx/default.conf` from `nginx/ssl.conf.tpl`, runs `nginx -t`, reloads, and installs a daily renew cron.

If HTTPS was skipped (DNS/firewall) on first install:

```bash
cd /opt/wacalls
sudo bash scripts/enable-ssl.sh
# or
wacalls ssl
```

Verify:

```bash
curl -fsS https://YOUR-DOMAIN/health
curl -I https://YOUR-DOMAIN/login
```

Git tracks HTTP-only `nginx/default.conf` (ACME + app proxy). `enable-ssl.sh` overwrites it from `nginx/ssl.conf.tpl` after certs exist. `scripts/update.sh` restores that SSL file after `git pull` so HTTPS is not wiped.

`setup.sh` keeps an existing `POSTGRES_PASSWORD` when `.env` already exists, so a re-run does not break the Postgres volume (P1000).

## Firewall

UFW allows 22, 80, 443 only. Do not publish 5432, 6379, 3000, 3001, or 4010.

## Backups

```bash
sudo /opt/wacalls/scripts/backup.sh
```

Daily cron retains 7 days (configurable). Restores are manual: gunzip SQL into postgres, extract session tarball onto the sessions volume.

## Updates

```bash
sudo /opt/wacalls/scripts/update.sh
```

Pulls git (if present), re-applies SSL nginx config when certs exist, backups, rebuilds, migrates, health-checks.

## Uninstall

```bash
sudo /opt/wacalls/scripts/uninstall.sh
# or
sudo /opt/wacalls/scripts/uninstall.sh --keep-data
```

You must type `DELETE WACALLS`. Volumes are not deleted unless you remove them yourself.
