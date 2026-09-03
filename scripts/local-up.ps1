# Local stack on Windows (Docker Desktop required). Does not touch VPS or GitHub.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File scripts/local-up.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker is not installed."
  Write-Host "Install Docker Desktop, restart the PC, then run this script again."
  Write-Host "https://docs.docker.com/desktop/setup/install/windows-install/"
  exit 1
}

Write-Host "==> Building and starting local WaCalls (ports 3000 / 3001, not 80)"
docker compose -f docker-compose.local.yml up --build -d

Write-Host "==> Waiting for API..."
$ok = $false
for ($i = 1; $i -le 40; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 3
}
if (-not $ok) {
  Write-Host "API did not become healthy. Logs:"
  docker compose -f docker-compose.local.yml logs --tail=80 api whatsapp
  exit 1
}

Write-Host "==> Migrations"
docker compose -f docker-compose.local.yml exec -T api sh -c "cd /app && pnpm --filter @wacalls/database migrate"

Write-Host "==> Admin seed (admin@localhost)"
docker compose -f docker-compose.local.yml exec -T api sh -c "cd /app && pnpm --filter @wacalls/database seed"

Write-Host ""
Write-Host "Local app:  http://localhost:3000/login"
Write-Host "Email:      admin@localhost"
Write-Host "Password:   LocalDev!2345"
Write-Host ""
Write-Host "Test QR on WhatsApp page, then dialer keypad."
Write-Host "When local testing is done, push GitHub and on VPS: sudo bash /opt/wacalls/scripts/update.sh"
