#!/usr/bin/env bash
# Ship the derived layer (canary.duckdb) from this laptop to the app server.
#
# This is the ONLY data that reaches the server. The raw archive (data/raw, 17GB+)
# and the pipeline stay local — the server just serves the ~440MB derived DB.
#
# Compact the DB first (COPY FROM DATABASE roughly halves it) — see DEPLOY.md.
#
# Run from anywhere:
#   CANARY_HOST=deploy@144.76.58.207 CANARY_SSH_KEY=resources/claude_pharos_mel \
#     ./deploy/push-duckdb.sh
#
# Optional:
#   CANARY_REMOTE_DIR   remote repo path        (default: /home/deploy/canary)
#   CANARY_SSH_KEY      identity file for ssh/scp
#   CANARY_RESTART=1    restart the api container after the push
set -euo pipefail

HOST="${CANARY_HOST:?set CANARY_HOST, e.g. deploy@144.76.58.207}"
REMOTE_DIR="${CANARY_REMOTE_DIR:-/home/deploy/canary}"
# Git Bash on the Windows dev machine ships ssh/scp but NOT rsync, so this script
# uses scp. Trade-off: no resumable --partial. If a push of the ~440MB DB dies
# midway, just re-run it — the atomic swap below means a failed transfer can never
# be served.
SSH_OPTS=()
[ -n "${CANARY_SSH_KEY:-}" ] && SSH_OPTS=(-i "$CANARY_SSH_KEY")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB="$REPO_ROOT/backend/data/canary.duckdb"

[ -f "$LOCAL_DB" ] || { echo "missing $LOCAL_DB — build the pipeline first (python -m app.pipeline.build)"; exit 1; }

echo "pushing $(du -h "$LOCAL_DB" | cut -f1) canary.duckdb -> $HOST:$REMOTE_DIR/backend/data/"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p '$REMOTE_DIR/backend/data'"

# Atomic swap: copy to a temp name, then mv on the remote so the api never reads a
# half-written file.
scp "${SSH_OPTS[@]}" "$LOCAL_DB" "$HOST:$REMOTE_DIR/backend/data/canary.duckdb.tmp"
# chmod because the api container runs as the non-root `canary` user and reads this
# file through a read-only bind mount — mode 600 here means 500s on every endpoint.
ssh "${SSH_OPTS[@]}" "$HOST" \
	"mv -f '$REMOTE_DIR/backend/data/canary.duckdb.tmp' '$REMOTE_DIR/backend/data/canary.duckdb' \
	 && chmod a+r '$REMOTE_DIR/backend/data/canary.duckdb'"

if [ "${CANARY_RESTART:-0}" = "1" ]; then
	echo "restarting api container..."
	ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_DIR' && docker compose restart api"
fi

echo "done."
