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

## SSL failed

DNS A record must point at the VPS **before** certbot. The installer does not change DNS. App may still be on HTTP until you retry certbot.

## Migrations failed

```bash
docker compose exec api sh -c 'cd /app && pnpm --filter @wacalls/database migrate'
docker compose logs api | tail
```

## Forgot you used mock in production

The factory refuses to boot. Set `CALLING_ENGINE=selfhosted` and `APP_ENV=production`.
