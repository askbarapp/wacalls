# Troubleshooting

## Health is degraded

`curl https://your.domain/health` — check `database`, `redis`, `whatsapp_engine`.

```bash
wacalls logs api
wacalls logs whatsapp
wacalls logs worker
```

## QR never becomes CONNECTED

- Phone must scan **Linked Devices**, not a chat QR
- One socket per account
- Watch `wacalls logs whatsapp`
- Session volume must be writable (`/data/sessions`)

## Call goes FAILED immediately

Read `failure_reason` on the call. Typical: `UNSUPPORTED_CAPABILITY` because baileys-caller/WASM is not loaded. QR working does **not** imply voice media works. See `docs/CALLING_ENGINE.md`.

## Two agents rang the same time

That is a bug. Confirm Redis lock keys `lock:whatsapp-channel:*` and that only one worker processed `place-call` with the lock held. Re-run `packages/queue` tests.

## SSL failed / site only works on HTTP

`curl -I http://127.0.0.1/` returning 200 while `curl -kI https://127.0.0.1/` fails with `SSL_ERROR_SYSCALL` means nginx is HTTP-only. Confirm with:

```bash
cd /opt/wacalls
docker compose exec nginx nginx -T 2>&1 | grep -E "listen|server_name|ssl_certificate"
```

If you only see `listen 80` and no `ssl_certificate`, certificates were never activated. Check:

1. DNS: `getent hosts your.domain` must match the VPS public IP
2. Hosting-panel firewall as well as UFW: 80 and 443
3. Cert files: `/opt/wacalls/certbot-certs/live/your.domain/fullchain.pem`

Then run:

```bash
sudo bash /opt/wacalls/scripts/enable-ssl.sh
```

Do not regenerate `POSTGRES_PASSWORD` in `.env` while the existing Postgres volume is still there — that causes Prisma `P1000`. Re-run `setup.sh` keeps the existing password.

After `git pull` / `wacalls update`, HTTPS is re-applied automatically if certs already exist. If you pulled by hand and login is HTTP-only again:

```bash
wacalls ssl
```

## Migrations failed

```bash
docker compose exec api sh -c 'cd /app && pnpm --filter @wacalls/database migrate'
docker compose logs api | tail
```

## Forgot you used mock in production

The factory refuses to boot. Set `CALLING_ENGINE=selfhosted` and `APP_ENV=production`.
