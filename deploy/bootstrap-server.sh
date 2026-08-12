#!/usr/bin/env bash
# NOT the current deployment path. Kept for the standalone-box case only.
#
# Since 2026-08-12 Canary shares the Hetzner EX44 with Pharos, where Docker, the
# firewall and the edge proxy (pharos-caddy) already exist — so none of this runs.
# Standing Canary up there is: git clone to /home/deploy/canary, scp the .env, push
# the DuckDB, `docker network create canary_edge`, `docker compose up -d`, then add
# the canarylayer.com block to /home/deploy/pharos/Caddyfile. See DEPLOY.md.
#
# NEVER run this against the EX44: it would install packages and enable ufw on a box
# running someone else's production. It is for a fresh, dedicated, empty server.
#
# One-time setup for a fresh Hetzner Ubuntu box (24.04 / 26.04). Run AS ROOT.
# Installs Docker + Compose, a basic firewall, and prepares the repo dir.
#
#   ssh root@<server-ip> 'bash -s' < deploy/bootstrap-server.sh
set -euo pipefail

REMOTE_DIR="${CANARY_REMOTE_DIR:-/opt/canary}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git ufw

# 2 GB swap — headroom so the one-time `docker compose build` (npm/vite + pip) can't
# OOM on a small (2 GB RAM) box. Serving never touches it; it's build insurance.
if [ ! -f /swapfile ]; then
	fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
	echo "swap enabled:"; free -h | grep -i swap
fi

# Docker Engine + Compose plugin (official convenience script).
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi

# Firewall: SSH + HTTP + HTTPS only.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p "$REMOTE_DIR"
echo "server ready. repo dir: $REMOTE_DIR"
docker --version
docker compose version
