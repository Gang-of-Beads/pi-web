#!/usr/bin/env bash
#
# Rebuild this checkout and restart the host PI WEB services that serve it.
#
# PI WEB is a systemd user service, not a pi extension, so "Update all" inside
# pi never touches it: a fork checkout only reaches the browser after a build
# and a restart. This script makes that one step and prints what actually
# shipped, because a silent no-op looks identical to a successful deploy.
#
# It restarts the session daemon, which terminates every session it owns —
# including one that a browser is mid-conversation with. Run it from a terminal
# that is not itself hosted by that daemon.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

echo "==> Checkout"
printf '    %s\n' "$repo_root"
printf '    branch %s @ %s\n' "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "    note: working tree has uncommitted changes; building them anyway"
fi

echo "==> Build"
npm run build

echo "==> Restart"
# The web process serves the built assets; the daemon owns the sessions. Restart
# the daemon first so the web process never briefly serves new assets against an
# old daemon.
systemctl --user restart pi-web-sessiond
systemctl --user restart pi-web

echo "==> Result"
for unit in pi-web-sessiond pi-web; do
  printf '    %-18s %s (pid %s)\n' \
    "$unit" \
    "$(systemctl --user is-active "$unit")" \
    "$(systemctl --user show -p MainPID --value "$unit")"
done

# The bundle hash is the only honest proof that the browser will load new code:
# a cached page can otherwise keep serving the previous build indefinitely.
bundle=$(find dist/client/assets -name 'index-*.js' -newermt '-10 minutes' 2>/dev/null | head -1 || true)
if [ -n "$bundle" ]; then
  printf '    bundle             %s\n' "$(basename "$bundle")"
else
  printf '    bundle             %s\n' "$(basename "$(find dist/client/assets -name 'index-*.js' | head -1)")"
fi

echo
echo "Hard-reload the browser if the UI looks unchanged; the old bundle may be cached."
