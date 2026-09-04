#!/usr/bin/env bash
# The one-command remote leg for a release round, run when the home network is
# back: real-network chaos from hxd-pc-ubuntu over tailscale against this
# machine's 8505 stack, then version verification on all three machines.
# Usage: bash scripts/remote-verify.sh [expected-version]
set -uo pipefail

EXPECTED="${1:-}"
MBP_URL="https://hxd-work-mbp.tailc9e96c.ts.net:8505"
FAIL=0

step() { printf '\n== %s\n' "$1"; }

step "machine reachability"
for host in hxd-pc-ubuntu hxd-pi; do
  if ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" true 2>/dev/null; then
    echo "ok: $host reachable"
  else
    echo "FAIL: $host unreachable"; FAIL=1
  fi
done
[ "$FAIL" -ne 0 ] && { echo "RESULT: machines missing, stop here"; exit 1; }

step "remote real-network chaos probe (ubuntu -> tailscale -> mbp 8505)"
scp -q scripts/probe-network-chaos.mjs hxd-pc-ubuntu:/tmp/probe-network-chaos.mjs
ssh hxd-pc-ubuntu "cd /tmp && PROBE_BASE=$MBP_URL node probe-network-chaos.mjs" 2>&1 | tail -12
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then echo "FAIL: chaos probe rc=$rc"; FAIL=1; else echo "ok: chaos probe passed"; fi

step "running versions on all three machines"
echo "astra-mbp: $(curl -s http://127.0.0.1:8504/api/pi-web/version | python3 -c 'import json,sys; print(json.load(sys.stdin)["components"]["web"]["runtimeVersion"])' 2>/dev/null)"
for host in hxd-pc-ubuntu hxd-pi; do
  v=$(ssh "$host" "curl -s http://127.0.0.1:8504/api/pi-web/version" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["components"]["web"]["runtimeVersion"])' 2>/dev/null)
  echo "$host: ${v:-UNKNOWN}"
  if [ -n "$EXPECTED" ] && [ "$v" != "$EXPECTED" ]; then echo "FAIL: $host not on $EXPECTED"; FAIL=1; fi
done

[ "$FAIL" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"
