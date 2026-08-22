#!/usr/bin/env bash
#
# Rebuild this checkout and restart the host PI WEB services that serve it.
#
# PI WEB is a systemd user service, not a pi extension, so "Update all" inside
# pi never touches it: a fork checkout only reaches the browser after a build
# and a restart. This script makes that one step and prints what actually
# shipped, because a silent no-op looks identical to a successful deploy.
#
# It restarts the session daemon. The daemon now waits for in-flight agent runs
# before exiting (PI_WEB_SHUTDOWN_DRAIN_MS), but systemd stops waiting at
# TimeoutStopSec and sends SIGKILL, so a long run can still be cut off. The
# script therefore reports what is running and refuses to restart while any run
# is in flight unless --force says otherwise.
#
# Run it from a terminal that is not itself hosted by that daemon.
#
# Usage: redeploy-host.sh [--dry-run] [--force]
#   --dry-run  build and report, change no running service
#   --force    restart even while agent runs are in flight
set -euo pipefail

dry_run=false
force=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --force) force=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

echo "==> Checkout"
printf '    %s\n' "$repo_root"
printf '    branch %s @ %s\n' "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  echo "    note: working tree has uncommitted changes; building them anyway"
fi

# Which build the running units actually execute.
#
# This script was written when the units ran this checkout, so building it and
# restarting them shipped the new code. The deployment then moved to the npm
# package installed through nix, and the units now execute a /nix/store path:
# building here changes a directory nothing serves, and the restart looks
# exactly as successful as it did before. That is the silent no-op this script
# exists to make impossible, so it checks rather than assumes.
unit_exec=$(systemctl --user show pi-web -p ExecStart --value 2>/dev/null || true)
case "$unit_exec" in
  *"$repo_root"*) serves_checkout=true ;;
  *) serves_checkout=false ;;
esac

echo "==> Deployment"
if [ "$serves_checkout" = true ]; then
  printf '    the pi-web units run this checkout\n'
else
  store_path=$(printf '%s' "$unit_exec" | grep -o '/nix/store/[^ ]*pi-web[^ /]*' | head -1)
  printf '    the pi-web units run %s\n' "${store_path:-a path outside this checkout}"
  echo "    Building here will NOT change what the browser loads."
  echo "    Ship through the package instead: scripts/pi-web-update.sh --force <flake-id>"
  if [ "$dry_run" != true ]; then
    echo "    Refusing to restart: it would take the services down for no gain."
    exit 1
  fi
fi

echo "==> Build"
npm run build

echo "==> In-flight runs"
# Asking the daemon is the only way to know; a restart decided without this is
# a guess about someone else's work.
api=http://127.0.0.1:8504/api/machines/local
streaming=$(curl -fsS --max-time 5 "$api/sessions/statuses" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const r = JSON.parse(s).statuses ?? [];
        const busy = r.filter((x) => x.isStreaming === true || x.isBashRunning === true);
        for (const b of busy) console.error(`    busy  ${b.sessionId.slice(0, 8)}  ${b.messageCount ?? 0} messages`);
        console.log(busy.length);
      } catch { console.log("unknown"); }
    })' 2>&1 >/dev/null || true)
streaming_count=$(curl -fsS --max-time 5 "$api/sessions/statuses" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { console.log((JSON.parse(s).statuses ?? []).filter((x)=>x.isStreaming===true||x.isBashRunning===true).length); }
      catch { console.log("unknown"); }
    })' || echo unknown)
printf '%s\n' "$streaming"
printf '    %s run(s) in flight\n' "$streaming_count"

if [ "$dry_run" = true ]; then
  echo "==> Restart (skipped: --dry-run)"
elif [ "$streaming_count" != "0" ] && [ "$force" != true ]; then
  echo "==> Restart (refused)"
  echo "    Runs are in flight. Wait for them, or re-run with --force to interrupt them."
  exit 1
else
echo "==> Restart"
# The web process serves the built assets; the daemon owns the sessions. Restart
# the daemon first so the web process never briefly serves new assets against an
# old daemon.
systemctl --user restart pi-web-sessiond
systemctl --user restart pi-web
fi

echo "==> Result"
for unit in pi-web-sessiond pi-web; do
  printf '    %-18s %s (pid %s)\n' \
    "$unit" \
    "$(systemctl --user is-active "$unit")" \
    "$(systemctl --user show -p MainPID --value "$unit")"
done

# The bundle hash is the only honest proof that the browser will load new code:
# a cached page can otherwise keep serving the previous build indefinitely.
# Read from index.html rather than guessing by modification time -- an unchanged
# build does not restamp the file, and picking the first of several is arbitrary.
bundle=$(sed -n 's/.*\/assets\/\(index-[A-Za-z0-9_-]*\.js\).*/\1/p' dist/client/index.html | head -1)
printf '    bundle on disk     %s\n' "${bundle:-unknown}"
# Compared even on a dry run: the mismatch between what this checkout builds
# and what the service serves is the single most useful thing this script can
# report, and skipping it on the safe path hid it from the safe path.
served=$(curl -fsS --max-time 5 http://127.0.0.1:8504/ 2>/dev/null \
  | sed -n 's/.*\/assets\/\(index-[A-Za-z0-9_-]*\.js\).*/\1/p' | head -1 || true)
printf '    bundle served      %s\n' "${served:-unreachable}"
if [ -n "$served" ] && [ "$served" != "$bundle" ]; then
  echo "    warning: the service is serving a different bundle than this build"
fi

echo
echo "Hard-reload the browser if the UI looks unchanged; the old bundle may be cached."
