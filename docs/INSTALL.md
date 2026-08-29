# Install

## Supported OS

- Ubuntu 22.04 LTS
- Ubuntu 24.04 LTS

Recommended: 2 CPU, 4 GB RAM, 40 GB SSD. AI workloads need more.

## VPS one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/askbarapp/wacalls/main/scripts/vps-install.sh | sudo bash
```

That clone step has no TTY, so it **stops after cloning**. Then run the installer on the server:

```bash
sudo bash /opt/wacalls/scripts/setup.sh
```

Do not pipe `setup.sh` itself into bash — admin password, domain, and SSL prompts need a real terminal.

## Installer

From the repository root (or `/opt/wacalls`):

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
6. Generate JWT, encryption, Postgres, and internal secrets (reuses `POSTGRES_PASSWORD` if `.env` already exists)
7. Start postgres, redis, api, worker, whatsapp, web, nginx
8. Run Prisma migrations and seed the first admin
9. Issue Let's Encrypt, write `nginx/default.conf` from `nginx/ssl.conf.tpl`, `nginx -t`, reload, install renew cron
10. Enable UFW (22/80/443 only)
11. Install the `wacalls` CLI (`status`, `logs`, `health`, `ssl`, …)

PostgreSQL (5432), Redis (6379), and app ports are **not** published publicly.

## DNS

The installer does **not** create DNS records. Create them **before** SSL can succeed:

```text
A    your.domain      SERVER_IP
A    www.your.domain  SERVER_IP
```

If certbot fails, HTTP still works (`nginx/http.conf` / default `listen 80`). Fix DNS, open 80/443 on the hosting firewall, then:

```bash
sudo bash /opt/wacalls/scripts/enable-ssl.sh
# or
wacalls ssl
```

That script: checks `/health`, verifies DNS, issues the cert, generates SSL nginx config, runs `nginx -t`, reloads, tests `https://DOMAIN/health` and `/login`, and installs daily renew.

## After install

```bash
wacalls status
wacalls health
wacalls ssl
wacalls logs
```

Open `https://your.domain/login`, create a WhatsApp channel, scan QR, open the dialer.

## Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

Mock engine only. Do not use this compose file in production.
