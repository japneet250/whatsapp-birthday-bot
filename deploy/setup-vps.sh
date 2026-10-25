#!/usr/bin/env bash
# One-command install on a fresh Ubuntu or Debian server
# (Oracle Cloud Always Free, Google Cloud free tier, any VPS, a Raspberry Pi).
#
#   curl -fsSL https://raw.githubusercontent.com/japneet250/whatsapp-birthday-bot/main/deploy/setup-vps.sh | TIMEZONE=America/Toronto bash
#
# Optional settings (put them before `bash`):
#   TIMEZONE=Europe/London     your timezone (asked for if not set)
#   DOMAIN=bday.example.com    your own domain; otherwise <server-ip>.sslip.io is used
#   NO_HTTPS=1                 skip Caddy/HTTPS and keep the dashboard on port 3000
#
# Safe to run again: it updates the code and restarts, keeping your data and password.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/japneet250/whatsapp-birthday-bot.git}"
APP_DIR="${APP_DIR:-$HOME/whatsapp-birthday-bot}"

say() { printf '\n\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
command -v apt-get >/dev/null || { echo "This script supports Ubuntu/Debian (apt). Use the Docker quick start in the README instead."; exit 1; }

# ---------- timezone ----------
if [ -z "${TIMEZONE:-}" ]; then
  if [ -r /dev/tty ]; then
    read -rp "Your timezone (e.g. America/Toronto, Europe/London) [UTC]: " TIMEZONE </dev/tty || true
  fi
  TIMEZONE="${TIMEZONE:-UTC}"
fi
if [ ! -e "/usr/share/zoneinfo/$TIMEZONE" ]; then
  echo "\"$TIMEZONE\" is not a valid timezone. Examples: America/Toronto, Europe/London, Asia/Kolkata"; exit 1
fi

# ---------- swap (1-2 GB machines need it for Chromium) ----------
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && [ "$swap_mb" -lt 1000 ]; then
  say "Adding 2 GB of swap (this server has ${mem_mb} MB of RAM)"
  $SUDO fallocate -l 2G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

# ---------- Docker + git ----------
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  say "Installing git and curl"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git curl ca-certificates >/dev/null
fi
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | $SUDO sh >/dev/null
  [ -n "$SUDO" ] && $SUDO usermod -aG docker "$USER" || true
fi
DOCKER="$SUDO docker"

# ---------- code ----------
if [ -d "$APP_DIR/.git" ]; then
  say "Updating the code in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  say "Downloading the code to $APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ---------- settings (.env) ----------
PUBLIC_IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || true)
if [ -z "${DOMAIN:-}" ] && [ -n "$PUBLIC_IP" ]; then DOMAIN="${PUBLIC_IP//./-}.sslip.io"; fi

set_env() { # set_env KEY VALUE: add or replace a line in .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

if [ ! -f .env ]; then
  say "Creating your settings file"
  PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-16)
  cp .env.example .env
  set_env DASHBOARD_PASSWORD "$PASSWORD"
fi
set_env TIMEZONE "$TIMEZONE"
[ -n "${DOMAIN:-}" ] && set_env DOMAIN "$DOMAIN"
PASSWORD=$(grep '^DASHBOARD_PASSWORD=' .env | cut -d= -f2-)

# ---------- firewall (Oracle's Ubuntu images block everything except SSH) ----------
open_port() {
  # Live rule, now
  if $SUDO iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
    $SUDO iptables -C INPUT -p tcp --dport "$1" -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT 1 -p tcp --dport "$1" -j ACCEPT
  fi
  # Saved rule, for after a reboot. Edit the file directly instead of `netfilter-persistent save`,
  # which would also freeze Docker's own rules into it.
  local f=/etc/iptables/rules.v4
  if [ -f "$f" ] && ! $SUDO grep -q -- "--dport $1 -j ACCEPT" "$f"; then
    $SUDO sed -i "0,/^-A INPUT -j REJECT/s//-A INPUT -p tcp -m state --state NEW -m tcp --dport $1 -j ACCEPT\n&/" "$f"
  fi
  if command -v ufw >/dev/null && $SUDO ufw status | grep -q 'Status: active'; then $SUDO ufw allow "$1"/tcp >/dev/null; fi
}
if [ -z "${NO_HTTPS:-}" ]; then PORTS="80 443"; else PORTS="3000"; fi
for p in $PORTS; do open_port "$p"; done

# ---------- start ----------
if [ -z "${NO_HTTPS:-}" ]; then
  COMPOSE=(-f docker-compose.yml -f deploy/docker-compose.vps.yml)
  URL="https://$DOMAIN"
else
  COMPOSE=(-f docker-compose.yml)
  URL="http://${PUBLIC_IP:-<server-ip>}:3000"
fi
say "Building and starting (the first build takes a few minutes)"
$DOCKER compose "${COMPOSE[@]}" up -d --build

say "Waiting for the bot to start"
healthy=""
for _ in $(seq 1 60); do
  if $DOCKER compose "${COMPOSE[@]}" exec -T birthday-bot node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then healthy=1; break; fi
  sleep 3
done
if [ -z "$healthy" ]; then
  warn "The bot didn't answer after 3 minutes. Recent logs:"
  $DOCKER compose "${COMPOSE[@]}" logs --tail 30 birthday-bot || true
  exit 1
fi

cat <<EOF

  ✅ Birthday Bot is running.

  Dashboard:  $URL
  Username:   anything
  Password:   $PASSWORD

  Next: open the dashboard, then on your phone go to
  WhatsApp > Settings > Linked devices > Link a device and scan the QR code.

  Useful commands (run in $APP_DIR):
    logs:     sudo docker compose ${COMPOSE[*]} logs -f birthday-bot
    update:   re-run this script
    preview:  sudo docker compose ${COMPOSE[*]} exec birthday-bot node src/cli.js preview

EOF
if [ -z "${NO_HTTPS:-}" ]; then
  warn "If the dashboard doesn't load, ports 80 and 443 are probably closed in your cloud provider's firewall."
  warn "Oracle: Networking > Virtual cloud networks > your VCN > Security Lists > add ingress rules for TCP 80 and 443 from 0.0.0.0/0."
  warn "Google Cloud: VM > Edit > tick 'Allow HTTP traffic' and 'Allow HTTPS traffic'."
fi
