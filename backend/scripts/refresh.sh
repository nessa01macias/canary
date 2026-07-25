#!/bin/zsh
# Canary data ratchet — run by launchd daily (see com.canary.refresh.plist).
# Fetches due sources -> rebuilds served attributes + pipeline -> freshness manifest
# -> optional off-laptop backup of data/raw (the moat) if rclone is configured.

set -u
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="$BACKEND/data/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/refresh-$(date +%Y-%m-%d).log"

{
  echo "=== canary refresh $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  cd "$BACKEND"
  source venv/bin/activate

  python3 -m app.ingestion.refresh
  RC=$?

  # Off-laptop backup of the irreplaceable layer. Configure once with:
  #   rclone config   (create a remote named 'canary-backup' -> B2/S3 bucket)
  if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q '^canary-backup:'; then
    echo "--- backup: rclone sync data/raw -> canary-backup:canary-raw"
    rclone sync "$BACKEND/data/raw" canary-backup:canary-raw \
      --transfers 4 --fast-list --log-level NOTICE
    echo "--- backup: freshness + processed"
    rclone copy "$BACKEND/data/processed" canary-backup:canary-processed --log-level NOTICE
  else
    echo "!!! NO BACKUP: rclone remote 'canary-backup' not configured — data/raw is on ONE laptop"
  fi

  echo "=== done rc=$RC $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  exit $RC
} >> "$LOG" 2>&1
