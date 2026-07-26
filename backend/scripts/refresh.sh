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

  # Off-laptop backup — IRREPLACEABLE sources only ($0 free-tier sized, ~200MB).
  # Everything else in data/raw is re-fetchable by re-running ingestion; these are
  # not: daily state dumps (source serves only today), pruned releases, live scrapes.
  # One-time setup: free Cloudflare R2 (10GB) or Backblaze B2 (10GB) bucket, then
  #   rclone config   -> remote named 'canary-backup'
  IRREPLACEABLE=(
    overture_places        # Overture prunes its own S3 releases
    fsq_os_places          # HF retention not guaranteed; 20-month backfill
    insideairbnb           # >12mo goes behind an archived-data request gate
    ca_abc_licenses        # daily dump; source serves only today's
    ca_cannabis_retailers  # live API; today only
    news_sf                # live web captures
    sanjose_planning_30d   # rolling 30-day window; daily capture IS the archive
  )
  if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q '^canary-backup:'; then
    for src in "${IRREPLACEABLE[@]}"; do
      [ -d "$BACKEND/data/raw/$src" ] && \
        rclone sync "$BACKEND/data/raw/$src" "canary-backup:canary-raw/$src" \
          --transfers 4 --fast-list --log-level NOTICE
    done
    rclone copy "$BACKEND/data/raw/manifest.jsonl" canary-backup:canary-raw/ --log-level NOTICE
    rclone copy "$BACKEND/data/processed" canary-backup:canary-processed --log-level NOTICE
    echo "--- backup: irreplaceable subset synced"
  else
    echo "!!! NO BACKUP of the irreplaceable subset (~200MB, \$0 on any free tier):"
    echo "!!!   1) free R2/B2 bucket  2) rclone config -> remote 'canary-backup'  (5 min, once)"
  fi

  echo "=== done rc=$RC $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  exit $RC
} >> "$LOG" 2>&1
