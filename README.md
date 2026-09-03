# WaCalls

**WhatsApp Web Calling & Sequential Dialer**

Self-hosted, multi-tenant platform for linking a WhatsApp account (QR / Linked Devices) and placing outbound WhatsApp voice calls from a browser dialer, with a one-call-per-channel queue shared by office agents.

This is **not** the official WhatsApp Business Cloud API. Outbound voice uses a native Go stack (`whatsmeow` + Meta MLow + pion WebRTC to WhatsApp relays), not the experimental WASM adapter.

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
| Outbound WhatsApp voice | Native Go (`whatsmeow` + MLow + pion), service `wa-native` |
| Ringing / answered / ended | Only when the engine emits those events |
| Audio file into call | Experimental, capability-flagged |
| Mock ringing in production | **Disabled** |

If the WASM adapter is not loaded, the dialer will show **FAILED** with `UNSUPPORTED_CAPABILITY`. That is intentional.

## Quick start (Ubuntu VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/askbarapp/wacalls/main/scripts/vps-install.sh | sudo bash
sudo bash /opt/wacalls/scripts/setup.sh
```

The curl pipe only clones (no TTY). `setup.sh` prompts for admin, domain, and SSL.

If HTTPS was skipped on first install (HTTP works, browser HTTPS does not):

```bash
sudo bash /opt/wacalls/scripts/enable-ssl.sh
```

Or after copying this repository to the server:

```bash
chmod +x scripts/*.sh
sudo ./scripts/setup.sh
```

Root `setup.sh` just execs `scripts/setup.sh`. Fresh VPS: Ubuntu 22.04 or 24.04, 2 CPU / 4 GB RAM / 40 GB disk recommended.

## Local testing (Windows)

Do **not** use XAMPP Apache/MySQL for this app. It needs Docker (Postgres + Redis + Node). Do **not** use production `docker-compose.yml` on this PC — that binds ports 80/443 and will clash with XAMPP.

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), then restart Windows.
2. From the repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local-up.ps1
```

3. Open `http://localhost:3000/login`  
   Email: `admin@localhost`  
   Password: `LocalDev!2345`

That stack uses the **real** WhatsApp QR engine (`selfhosted`). After QR works, test the dialer keypad and campaigns locally.

UI-only mock (fake QR, auto-connect):

```bash
docker compose -f docker-compose.dev.yml up --build
```

When local testing is done: push `main`, then on the VPS `sudo bash /opt/wacalls/scripts/update.sh`.

## Development (mock engine)

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
scripts/          setup, enable-ssl, backup, update, uninstall, vps-install
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
