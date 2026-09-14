# WaCall OS (WAO) — 1-Click Server Installation & Deployment Guide

This package contains the complete, production-ready codebase of **WaCall OS (WAO)** with:
- **WhatsApp Commander & Voice Calling Hub**
- **AI Task & Reminder Engine (Action Center)**
- **AI Email Command Center**
- **Creative Studio with Automated Festival Autopilot**
- **Invoicing, Quotes & Pending Payments**
- **Live Call Intelligence & Multi-Member Role Delegation**

---

## ⚡ Quick 1-Step Installation (Any Linux Server)

### Requirements:
- **OS**: Ubuntu 20.04, 22.04, 24.04 or Debian 11, 12
- **Hardware**: Minimum 2 CPU cores, 4 GB RAM, 25 GB free disk space
- **Ports**: 80, 443 (TCP), 22 (SSH), and 10000–10031 (UDP for WhatsApp Voice RTP)

---

### Step 1: Upload the `WAO` Folder to your Server
Upload the `WAO` folder or `WAO.zip` to your server (e.g. into `/opt/wacalls` or `/root/WAO`):

```bash
# If using scp/rsync from local machine:
scp -r WAO root@your-server-ip:/opt/wacalls

# Or if uploaded as zip:
unzip WAO.zip -d /opt/wacalls
```

---

### Step 2: Run the Automated Installer
SSH into your server, navigate to the folder, and run `install.sh`:

```bash
cd /opt/wacalls
sudo bash install.sh
```

#### Or Non-Interactive with Pre-Configured Domain:
```bash
DOMAIN=yourdomain.com sudo bash install.sh
```

---

### 🛠️ What `install.sh` Automatically Does:
1. Installs Docker Engine, Docker Compose Plugin, OpenSSL, UFW, Fail2ban, and system tools.
2. Prompts for your primary domain (or defaults to your server's Public IPv4).
3. Automatically generates secure, high-entropy random keys:
   - Database Password (`POSTGRES_PASSWORD`)
   - `JWT_SECRET`
   - `ENCRYPTION_KEY`
   - `INTERNAL_TOKEN`
4. Automatically opens all required firewall ports (80, 443, 22 TCP & 10000-10031 UDP).
5. Configures Nginx reverse proxy with WebSocket support and Let's Encrypt SSL certificates.
6. Builds Docker images for Web, API, Worker, WhatsApp Bridge, Redis, and Postgres.
7. Executes database migrations (`prisma db push`) automatically.
8. Performs a health check and prints all ready URLs.

---

## 🔄 Everyday Management Commands

```bash
# View live logs of all services
docker compose logs -f

# View live logs of a specific service (e.g. API, Web, WhatsApp)
docker compose logs -f api
docker compose logs -f web
docker compose logs -f whatsapp

# Restart all services
docker compose restart

# Stop all services
docker compose down

# Rebuild after making code edits
docker compose up -d --build
```
