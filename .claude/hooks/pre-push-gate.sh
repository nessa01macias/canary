#!/bin/bash
# Pre-push quality gate (PreToolUse on Bash — global, applies to every
# project). Blocks `git push` once per commit until Claude has actually run
# /verify + /code-review against it — the manual step Kati was relying on
# an engineer to do after the fact.
#
# Self-gates on the actual command from stdin instead of trusting the
# hook's declarative `if: "Bash(git push*)"` filter alone — in testing that
# filter fired for unrelated commands too (e.g. `echo $SHELL`), root cause
# unclear, so this check is the real safety net regardless of whether `if`
# is behaving.
COMMAND=$(cat | jq -r '.tool_input.command // empty' 2>/dev/null)
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|]) *git push'; then
  exit 0
fi

# Marker path is intentionally relative (resolves against whatever project
# the session's cwd is in, not this script's own location), so "reviewed"
# state stays per-repo even though the gate itself is global. If HEAD still
# matches the marker, the push is already covered and goes through
# untouched.
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null)
MARKER=".claude/.last-reviewed-sha"

if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$CURRENT_SHA" ]; then
  exit 0
fi

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Pre-push quality gate: run /verify then /code-review on the changes about to be pushed before this push proceeds. If review makes fixes, commit them. Either way, once clean, run: git rev-parse HEAD > .claude/.last-reviewed-sha -- then retry the push."}}
EOF
