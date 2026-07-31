#!/usr/bin/env bash
# One-screen answer to "is the capture job healthy, and what did it do?"
#   ssh root@5.78.144.35 canary-refresh-status        # recent history
#   ssh root@5.78.144.35 'canary-refresh-status -v'   # + full log of the last run
set -uo pipefail

LOGDIR=/var/log/canary
LEDGER="$LOGDIR/runs.jsonl"
verbose=${1:-}

echo "=== schedule ==="
systemctl list-timers canary-refresh.timer --no-pager 2>/dev/null \
  | sed -n '1,2p' || echo "timer not installed"
enabled=$(systemctl is-enabled canary-refresh.timer 2>/dev/null || echo unknown)
active=$(systemctl is-active canary-refresh.timer 2>/dev/null || echo unknown)
echo "timer: $enabled / $active"

echo
echo "=== last 10 runs (newest last) ==="
if [ -s "$LEDGER" ]; then
  # Columns chosen so a bad run is obvious at a glance: status, what it captured,
  # and whether the disk moved.
  printf '%-18s %-8s %6s %4s %4s %4s %8s %9s\n' \
    RUN STATUS DUR RUN SKIP FAIL CAPTURED FREE_AFTER
  tail -n 10 "$LEDGER" | while IFS= read -r line; do
    python3 - "$line" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit()
print("%-18s %-8s %5ss %4s %4s %4s %7sMB %8sMB" % (
    d.get("run_id","?"), d.get("status","?"), d.get("duration_s","?"),
    d.get("sources_run","?"), d.get("sources_skipped","?"), d.get("sources_failed","?"),
    d.get("captured_mb","?"), d.get("disk_free_mb_after","?")))
if d.get("failed_keys"):
    print("    failed: %s" % ", ".join(d["failed_keys"]))
if d.get("note"):
    print("    note:   %s" % d["note"])
PY
  done
else
  echo "no runs recorded yet ($LEDGER is empty)"
fi

echo
echo "=== disk ==="
df -h / | awk 'NR==1||NR==2'
du -sh /opt/canary/backend/data/raw 2>/dev/null | sed 's/^/raw archive: /'

echo
echo "=== systemd's view of the last run ==="
systemctl status canary-refresh.service --no-pager -n 5 2>/dev/null \
  | sed -n '1,12p' || true

if [ "$verbose" = "-v" ]; then
  last=$(ls -1t "$LOGDIR"/refresh-*.log 2>/dev/null | head -1)
  if [ -n "$last" ]; then
    echo
    echo "=== full log: $last ==="
    cat "$last"
  fi
fi

echo
echo "more:  journalctl -u canary-refresh -n 50        (systemd log)"
echo "       ls $LOGDIR/                               (per-run logs, 30d)"
