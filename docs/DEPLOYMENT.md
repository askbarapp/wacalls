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

`scripts/setup.sh` uses Certbot webroot + Nginx. Renewal is a cron `certbot renew`. You can verify with:

```bash
docker run --rm -v /opt/wacalls/certbot-certs:/etc/letsencrypt certbot/certbot renew --dry-run
```

HTTP is redirected to HTTPS once certificates exist (`nginx/ssl.conf.tpl`).

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

Pulls git (if present), backups, rebuilds, migrates, health-checks.

## Uninstall

```bash
sudo /opt/wacalls/scripts/uninstall.sh
# or
sudo /opt/wacalls/scripts/uninstall.sh --keep-data
```

You must type `DELETE WACALLS`. Volumes are not deleted unless you remove them yourself.
