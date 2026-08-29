# WaCalls Architecture

WaCalls is a self-hosted, multi-tenant WhatsApp web calling platform. Product surfaces (dashboard, campaigns, API, widget) depend only on the `CallingEngine` interface.

## System context

```text
                    ┌─────────────┐     ┌──────────────┐
  Browser agents ───►  Nginx TLS  ├────►│ Next.js web  │
  Widget sites   ───►             ├────►│ Fastify API  │
                    └─────────────┘     └──────┬───────┘
                                               │ JWT + RBAC
                                               ▼
                                        PostgreSQL
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
                 Redis                    BullMQ worker              WhatsApp svc
             locks/pubsub                campaigns/webhooks         CallingEngine
                    │                                                     │
                    │                          ┌──────────────────────────┤
                    │                          ▼                          ▼
                    │                 SelfHostedWhatsAppEngine     WavoipAdapter
                    │                 (Baileys + optional WASM)    (optional)
                    │                          │
                    └──────── events ──────────┘
```

## Modular calling

```text
CallingEngine
├── SelfHostedWhatsAppEngine   # default; Baileys session + optional baileys-caller WASM
├── WavoipAdapter              # optional/future; not imported by product code
└── MockEngine                 # APP_ENV=development AND CALLING_ENGINE=mock only
```

Rules:

- Apps and workers import `@wacalls/calling-engine` factory only.
- No `wavoip` types leak into Prisma, REST, or React.
- Each engine publishes `EngineCapabilities`. UI hides unsupported actions.
- Production refuses to boot if `CALLING_ENGINE=mock`.

## Process boundaries (Docker Compose)

| Service | Responsibility |
| --- | --- |
| `nginx` | TLS, HTTP→HTTPS, reverse proxy, widget static |
| `web` | Next.js UI |
| `api` | Auth, REST, WebSocket, health, widget API |
| `worker` | BullMQ processors (calls, campaigns, webhooks, CSV, retries) |
| `whatsapp` | Session sockets, QR, `CallingEngine`, internal call RPC |
| `postgres` | System of record |
| `redis` | Locks, queues, live presence |

Persistent volumes: `postgres_data`, `redis_data`, `whatsapp_sessions`, `recordings`.

## Multi-tenancy

Every business table includes `organization_id`. API loaders always filter by the JWT org (super-admin may switch org explicitly). Session directories are `sessions/{organizationId}/{channelId}/` and are never served over HTTP.

## Channel lock (MAX_ACTIVE_CALLS = 1)

Redis key: `lock:whatsapp-channel:{channelId}`

- `SET key owner PX ttl NX`
- Release with Lua compare-and-del
- Heartbeat extends TTL while ANSWERED/RINGING
- Worker jobs that cannot acquire the lock are delayed, not parallelized
- Live queue position is `queue:channel:{channelId}` (Redis list)

This is the only way four agents share one WhatsApp number.

## Call path

```text
Agent clicks CALL
  → API creates Call (QUEUED) in a transaction
  → enqueue BullMQ job (jobId = callId, idempotent)
  → worker tries channel lock
       lost → wait, update queue position
       won  → POST whatsapp internal /calls
  → engine initiateCall
  → events over Redis pub/sub `events:org:{organizationId}`
  → API WebSocket → dialer
  → hangup / ended → release lock → next job
```

## Internal WhatsApp RPC

The WhatsApp container is not public. API/worker use Docker DNS `http://whatsapp:4010`:

- `POST /internal/channels/:id/connect`
- `GET  /internal/channels/:id/qr`
- `POST /internal/channels/:id/disconnect`
- `POST /internal/calls`
- `POST /internal/calls/:id/hangup`
- `POST /internal/calls/:id/mute`
- `POST /internal/calls/:id/audio` (PCM frames)
- `GET  /health`

Shared secret: `INTERNAL_TOKEN`.

## Audio and AI

```text
AudioEngine     playFile / stop / convert / getSupportedFormats
AIProvider      transcribe / generateResponse / synthesize
```

Recorded campaigns call `AudioEngine.playFile` only if `capabilities.recordedPlayback`. Otherwise the campaign type is rejected at start with a clear error.

## Security

- Argon2id passwords, JWT access + rotating refresh cookies
- Helmet, CORS allowlist, rate limits, Zod validation
- Prisma parameterized queries
- API keys hashed at rest (`wc_live_` prefix shown once)
- Webhook HMAC-SHA256 signatures
- Session files encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM envelope)
- RBAC: SUPER_ADMIN, ORG_ADMIN, MANAGER, AGENT
- Agents cannot read session blobs or WhatsApp credentials

## Observability

- Pino JSON logs (redact auth, cookies, session keys)
- `GET /health` and `GET /ready`
- Prometheus `/metrics` (active_calls, queued_calls, …)
- Docker log tags: `api`, `worker`, `whatsapp`, `web`

## Policy

WaCalls uses WhatsApp Web / linked-device protocols. It is **not** an official WhatsApp Business API product. See `docs/SECURITY.md` and `docs/CALLING_ENGINE.md`.
