#!/usr/bin/env bash
# Ship the derived layer (canary.duckdb) from this laptop to the app server.
#
# This is the ONLY data that reaches the server. The raw archive (data/raw, 3.2GB+)
# and the pipeline stay local — the server just serves the ~200MB derived DB.
#
# Run from anywhere:
#   CANARY_HOST=root@1.2.3.4 ./deploy/push-duckdb.sh
#
# Optional:
#   CANARY_REMOTE_DIR   remote repo path        (default: /opt/canary)
#   CANARY_RESTART=1    restart the api container after the push
set -euo pipefail

HOST="${CANARY_HOST:?set CANARY_HOST, e.g. root@1.2.3.4}"
REMOTE_DIR="${CANARY_REMOTE_DIR:-/opt/canary}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB="$REPO_ROOT/backend/data/canary.duckdb"

[ -f "$LOCAL_DB" ] || { echo "missing $LOCAL_DB — build the pipeline first (python -m app.pipeline.build)"; exit 1; }

echo "pushing $(du -h "$LOCAL_DB" | cut -f1) canary.duckdb -> $HOST:$REMOTE_DIR/backend/data/"
ssh "$HOST" "mkdir -p '$REMOTE_DIR/backend/data'"

# Atomic swap: rsync to a temp name, then mv on the remote so the api never reads a
# half-written file. --partial keeps interrupted transfers resumable.
rsync -avz --partial --progress \
	"$LOCAL_DB" "$HOST:$REMOTE_DIR/backend/data/canary.duckdb.tmp"
ssh "$HOST" "mv -f '$REMOTE_DIR/backend/data/canary.duckdb.tmp' '$REMOTE_DIR/backend/data/canary.duckdb'"

if [ "${CANARY_RESTART:-0}" = "1" ]; then
	echo "restarting api container..."
	ssh "$HOST" "cd '$REMOTE_DIR' && docker compose restart api"
fi

echo "done."
