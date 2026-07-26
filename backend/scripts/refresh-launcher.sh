#!/bin/zsh
# Canary ratchet launcher — lives OUTSIDE iCloud-synced ~/Documents on purpose:
# launchd got a dataless iCloud placeholder for the repo script at fire time
# (2026-07-25 07:07, exit 127 "can't open input file"). This launcher nudges
# iCloud to materialize the real script, then hands off to it.
SCRIPT="/Users/melany.macias/Documents/Personal/canary/backend/scripts/refresh.sh"
for i in {1..30}; do
  if [ -r "$SCRIPT" ] && head -c1 "$SCRIPT" >/dev/null 2>&1; then
    exec /bin/zsh "$SCRIPT"
  fi
  brctl download "$SCRIPT" 2>/dev/null
  sleep 10
done
echo "canary-refresh: $SCRIPT unreadable after 5m (iCloud eviction?)" >&2
exit 127
