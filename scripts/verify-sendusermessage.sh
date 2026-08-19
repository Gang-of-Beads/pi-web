#!/usr/bin/env bash
#
# Verify pi.sendUserMessage() from a slash-command handler starts a turn in
# PI WEB, against the real feynman-style extension shape (a command whose
# handler awaits pi.sendUserMessage while idle).
#
# Uses a throwaway session against a running PI WEB instance's sessiond API.
# Requires: a reachable /api/machines/local with the feynman extension (or any
# extension registering a sendUserMessage-style command) installed, and an
# API key/provider configured. Idempotent: archives its own session at the end.
#
# Exit 0 = kickoff persisted + turn started. Non-zero = failure.
set -euo pipefail

api="${PI_WEB_API:-http://127.0.0.1:8504/api/machines/local}"
cwd="${PI_WEB_VERIFY_CWD:-$(pwd)}"
command_text="${1:-/feynman_teach What is NAT?}"

echo "==> PI WEB self-update/host check"
curl -fsS --max-time 5 "$api/../pi-web/update/status" >/dev/null || true

echo "==> Create session"
session_json=$(curl -fsS --max-time 10 -X POST "$api/sessions" -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys;print(json.dumps({'cwd': '$cwd'}))")")
session_id=$(printf '%s' "$session_json" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "    session $session_id"

cleanup() { curl -fsS --max-time 5 -X POST "$api/sessions/$session_id/archive" -H 'content-type: application/json' -d "{\"cwd\":\"$cwd\"}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Send slash command: $command_text"
curl -fsS --max-time 15 -X POST "$api/sessions/$session_id/prompt" -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys;print(json.dumps({'cwd': '$cwd', 'text': '$command_text'}))")" >/dev/null

echo "==> Wait for the turn to start"
for i in $(seq 1 30); do
  status=$(curl -fsS --max-time 5 "$api/sessions/$session_id/status?cwd=$cwd")
  streaming=$(printf '%s' "$status" | python3 -c "import json,sys;d=json.load(sys.stdin);print('true' if d.get('isStreaming') else 'false')")
  count=$(printf '%s' "$status" | python3 -c "import json,sys;print(json.load(sys.stdin).get('messageCount',0))")
  echo "    t=${i}s streaming=$streaming messages=$count"
  if [ "$streaming" = "true" ]; then
    echo "==> PASS: turn started (streaming observed), kickoff persisted via messageCount=$count"
    exit 0
  fi
  sleep 1
done

echo "==> FAIL: no turn within 30s" >&2
exit 1
