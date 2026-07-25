#!/usr/bin/env bash
# One-time setup for a fresh Hetzner Ubuntu box (24.04 / 26.04). Run AS ROOT on the
# server. Installs Docker + Compose, a basic firewall, and prepares /opt/canary.
#
#   ssh root@<server-ip> 'bash -s' < deploy/bootstrap-server.sh
#
# After this: push canary.duckdb (deploy/push-duckdb.sh), copy the repo + .env, then
# `docker compose up -d --build`. See DEPLOY.md.
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
