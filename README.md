# WaCalls

**WhatsApp Web Calling & Sequential Dialer**

Self-hosted, multi-tenant platform for linking a WhatsApp account (QR / Linked Devices) and placing outbound WhatsApp voice calls from a browser dialer, with a one-call-per-channel queue shared by office agents.

This is **not** the official WhatsApp Business Cloud API. It uses the WhatsApp Web / multi-device protocol (Baileys) and, for real voice media, an experimental WhatsApp Web VoIP WASM adapter. Read `docs/FEASIBILITY.md` and `docs/CALLING_ENGINE.md` before production use.

## What it does

- QR connect and persistent WhatsApp sessions
- Web dialer (manual numbers)
- Contacts, CSV import, lists
- Sequential campaigns (one live call per WhatsApp number)
- Redis channel lock + BullMQ queue
- Call history, analytics, live monitor
- Recorded / AI-voice **architecture** (capability-gated; never faked)
- Embeddable Call Now widget
- REST API + signed webhooks
- Admin / manager / agent roles, multi-tenant isolation
- Docker Compose + Ubuntu installer (`setup.sh`) with SSL and firewall

## Honest calling status

| Feature | Status |
| --- | --- |
| QR + session persist | Supported (Baileys) |
| Outbound WhatsApp voice | Experimental (optional `baileys-caller` WASM stack) |
| Ringing / answered / ended | Only when the engine emits those events |
| Audio file into call | Experimental, capability-flagged |
| Mock ringing in production | **Disabled** |

If the WASM adapter is not loaded, the dialer will show **FAILED** with `UNSUPPORTED_CAPABILITY`. That is intentional.

## Quick start (Ubuntu VPS)

```bash
chmod +x scripts/setup.sh
sudo ./scripts/setup.sh
```

Or after copying this repository to the server:

```bash
sudo ./setup.sh
```

(`setup.sh` lives in `scripts/` and is the installer. You may `cp scripts/setup.sh .` if you prefer.)

A convenience copy is also referenced as `scripts/setup.sh`. Fresh VPS target: Ubuntu 22.04 or 24.04, 2 CPU / 4 GB RAM / 40 GB disk recommended.

## Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

Development compose sets `APP_ENV=development` and `CALLING_ENGINE=mock`. Mock mode is refused in production.

## Repository layout

```text
apps/web          Next.js UI
apps/api          Fastify API + WebSocket
services/whatsapp CallingEngine process (Baileys / WASM / mock)
services/worker   BullMQ (calls, campaigns, webhooks)
packages/*        shared, database, auth, queue, calling-engine, audio-engine
scripts/          setup, backup, update, uninstall
docs/             architecture and limitations
```

## Documentation

| Doc | Topic |
| --- | --- |
| [docs/FEASIBILITY.md](docs/FEASIBILITY.md) | What is technically possible |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Build order |
| [docs/INSTALL.md](docs/INSTALL.md) | Installer walkthrough |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker / DNS / SSL |
| [docs/API.md](docs/API.md) | REST API |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, tenancy, secrets |
| [docs/CALLING_ENGINE.md](docs/CALLING_ENGINE.md) | Engine adapters |
| [docs/AI.md](docs/AI.md) | STT/LLM/TTS |
| [docs/WIDGET.md](docs/WIDGET.md) | Website widget |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common failures |

## Policy

Do not use WaCalls to spam, rotate numbers to evade bans, or bypass WhatsApp enforcement. Honor DO_NOT_CALL. You are responsible for telecom, recording, and privacy law in your region.

## License

UNLICENSED / proprietary unless you add a license. Third-party components (Baileys, baileys-caller, WhatsApp WASM) have their own terms. WhatsApp WASM is Meta’s binary; we do not relicense it.
