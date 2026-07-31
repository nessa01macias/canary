#!/usr/bin/env bash
# Canary off-laptop capture runner (Hetzner 5.78.144.35, invoked by canary-refresh.timer).
#
# Captures the PERISHABLE daily sources only — state dumps and rolling windows that
# the source stops serving tomorrow. It deliberately does NOT run the weekly/monthly
# archive pulls or `make pipeline`: this box has 2 vCPU / 2GB RAM and shares its disk
# with production, and a full rebuild would exhaust both. Those stay on a workstation.
#
# Everything it does is logged three ways:
#   journald           journalctl -u canary-refresh          (systemd's own record)
#   per-run text log   /var/log/canary/refresh-<runid>.log   (full stdout, 30d)
#   run ledger         /var/log/canary/runs.jsonl            (one JSON line per run)
set -uo pipefail

REPO=/opt/canary
BACKEND="$REPO/backend"
PY="$BACKEND/venv/bin/python"
LOGDIR=/var/log/canary
LEDGER="$LOGDIR/runs.jsonl"
RETAIN_DAYS=30

# Abort rather than fill the disk out from under production. The daily capture is
# tens of MB; 3GB of headroom is a wide margin that still catches real trouble.
MIN_FREE_MB=3072
# A stuck fetch must not run into the next day's job.
MAX_SECONDS=3600

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUNLOG="$LOGDIR/refresh-$RUN_ID.log"
mkdir -p "$LOGDIR"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start_epoch=$(date +%s)
free_before_mb=$(df -Pm / | awk 'NR==2{print $4}')
raw_before_mb=$(du -sm "$BACKEND/data/raw" 2>/dev/null | cut -f1 || echo 0)

# JSON-safe string emitter (escapes the few characters that can appear in an error).
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr -d '\n'; }

emit_ledger() {
  local status="$1" rc="$2" note="$3"
  local ended_at end_epoch free_after_mb raw_after_mb
  ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  end_epoch=$(date +%s)
  free_after_mb=$(df -Pm / | awk 'NR==2{print $4}')
  raw_after_mb=$(du -sm "$BACKEND/data/raw" 2>/dev/null | cut -f1 || echo 0)
  printf '{"run_id":"%s","started_at":"%s","ended_at":"%s","duration_s":%s,"status":"%s","rc":%s,"sources_run":%s,"sources_skipped":%s,"sources_failed":%s,"failed_keys":[%s],"captured_mb":%s,"disk_free_mb_before":%s,"disk_free_mb_after":%s,"note":"%s"}\n' \
    "$RUN_ID" "$started_at" "$ended_at" "$((end_epoch - start_epoch))" \
    "$status" "$rc" "${n_run:-0}" "${n_skip:-0}" "${n_fail:-0}" "${failed_json:-}" \
    "$((raw_after_mb - raw_before_mb))" "$free_before_mb" "$free_after_mb" \
    "$(json_escape "$note")" >> "$LEDGER"
}

# --- preflight -------------------------------------------------------------
if [ ! -x "$PY" ]; then
  echo "FATAL: no interpreter at $PY" | tee -a "$RUNLOG"
  emit_ledger "aborted" 127 "missing venv at $PY"
  exit 127
fi

if [ "$free_before_mb" -lt "$MIN_FREE_MB" ]; then
  echo "FATAL: only ${free_before_mb}MB free on / (need ${MIN_FREE_MB}MB) — refusing to fetch" | tee -a "$RUNLOG"
  emit_ledger "aborted" 28 "low disk: ${free_before_mb}MB free"
  exit 28
fi

# --- capture ---------------------------------------------------------------
{
  echo "=== canary capture run $RUN_ID ==="
  echo "started      $started_at"
  echo "disk free    ${free_before_mb}MB"
  echo "raw dir      ${raw_before_mb}MB"
  echo "scope        --tier daily --fetch-only"
  echo
} | tee -a "$RUNLOG"

# nice/ionice keep the fetch from competing with the API for the 2 shared vCPUs.
timeout --signal=TERM --kill-after=60 "$MAX_SECONDS" \
  nice -n 10 ionice -c2 -n7 \
  "$PY" -m app.ingestion.refresh --tier daily --fetch-only \
  >> "$RUNLOG" 2>&1
rc=$?

# --- summarise -------------------------------------------------------------
# refresh.py prints one line per source: "[run ] key", "[skip] key", "[FAIL] key:".
n_run=$(grep -c '^\[run \]' "$RUNLOG" || true)
n_skip=$(grep -c '^\[skip\]' "$RUNLOG" || true)
n_fail=$(grep -c '^\[FAIL\]' "$RUNLOG" || true)
failed_json=$(grep '^\[FAIL\]' "$RUNLOG" | sed 's/^\[FAIL\] \([^:]*\).*/"\1"/' | paste -sd, - || true)

case $rc in
  0)   status="ok" ;;
  124) status="timeout" ;;
  *)   status="failed" ;;
esac
[ "$rc" -eq 0 ] && [ "${n_fail:-0}" -gt 0 ] && status="partial"

emit_ledger "$status" "$rc" ""

{
  echo
  echo "=== $status (rc=$rc) — ran ${n_run}, skipped ${n_skip}, failed ${n_fail} ==="
  echo "ended        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "duration     $(( $(date +%s) - start_epoch ))s"
} | tee -a "$RUNLOG"

# systemd captures this line, so `systemctl status` shows the outcome at a glance.
echo "canary capture $RUN_ID: $status (ran=$n_run skipped=$n_skip failed=$n_fail, rc=$rc)"

find "$LOGDIR" -name 'refresh-*.log' -mtime +$RETAIN_DAYS -delete 2>/dev/null || true
exit $rc
