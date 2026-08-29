# Install

## Supported OS

- Ubuntu 22.04 LTS
- Ubuntu 24.04 LTS

Recommended: 2 CPU, 4 GB RAM, 40 GB SSD. AI workloads need more.

## Installer

From the repository root:

```bash
chmod +x scripts/*.sh
sudo ./scripts/setup.sh
```

The script will:

1. Verify OS, root, and resources
2. Update apt and install curl, git, ufw, fail2ban, …
3. Install Docker and Compose
4. Copy the app to `/opt/wacalls`
5. Prompt for admin email, password, and domain (password is not printed)
6. Generate JWT, encryption, Postgres, and internal secrets
7. Start postgres, redis, api, worker, whatsapp, web, nginx
8. Run Prisma migrations and seed the first admin
9. Attempt Let's Encrypt if DNS already points at the server
10. Enable UFW (22/80/443 only)
11. Install the `wacalls` CLI

PostgreSQL (5432), Redis (6379), and app ports are **not** published publicly.

## DNS

The installer does **not** create DNS records. Create:

```text
A    your.domain      SERVER_IP
A    www.your.domain  SERVER_IP
```

If certbot fails, the app still serves HTTP. Fix DNS and issue a certificate later.

## After install

```bash
wacalls status
wacalls health
wacalls logs
```

Open `https://your.domain/login`, create a WhatsApp channel, scan QR, open the dialer.

## Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

Mock engine only. Do not use this compose file in production.
