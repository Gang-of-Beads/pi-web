#!/usr/bin/env bash
#
# Auto-update the host PI WEB without breaking sessions.
#
# Watches the fork checkout on this host. When the remote main branch has new
# commits it pulls, builds, and - only after every in-flight run has finished -
# restarts the daemon and web service. Runs are the one thing a restart can
# cut short (systemd gives the drain at most TimeoutStopSec before SIGKILL),
# so this script waits for them instead of racing them.
#
# Designed to run from a systemd user timer. Safe to run by hand too: with
# nothing new on the remote it prints "up to date" and exits.
#
# Continuity notes (why a restart does not lose a session):
#   * session transcripts, unread marks, renames and archives live on disk in
#     ~/.pi-web, so every session survives the restart intact;
#   * a run that is still active when the daemon exits gets an interrupted
#     record in ~/.pi-web/in-flight-runs.json and shows up in the UI's
#     interrupted-runs group, so it can be resumed;
#   * the browser reconnects its socket after the web process comes back.
set -euo pipefail

log() { printf '%s %s\n' "$(date +%F_%T)" "$*"; }

repo=/home/hanxiaodu/pi-web-upstream
api=http://127.0.0.1:8504/api/machines/local
lock=/tmp/pi-web-auto-update.lock
wait_timeout_seconds=$((6 * 60 * 60))   # give up after 6h of continuous work
poll_seconds=10

exec 9>"$lock"
flock -n 9 || { log "another auto-update is already running; exiting"; exit 0; }

cd "$repo"

log "checking $(git rev-parse --abbrev-ref HEAD) against fork remote"
git fetch -q fork

branch=$(git rev-parse --abbrev-ref HEAD)
remote_sha=$(git rev-parse "fork/$branch" 2>/dev/null || true)
if [ -z "$remote_sha" ] || [ "$remote_sha" = "$(git rev-parse HEAD)" ]; then
  log "up to date ($(git rev-parse --short HEAD)); nothing to do"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  log "working tree is dirty; refusing to pull over uncommitted changes (exit 3)"
  exit 3
fi

log "pulling $branch -> $(git rev-parse --short "$remote_sha")"
git merge --ff-only "fork/$branch"

log "building"
npm run build
log "build succeeded"

# Wait for in-flight runs before restarting. This is the whole point of the
# watcher: a deploy triggered by hand can refuse/--force, but an unattended
# deploy must not kill someone's run.
start=$(date +%s)
while true; do
  busy=$(curl -fsS --max-time 5 "$api/sessions/statuses" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try { const r = JSON.parse(s).statuses ?? [];
          console.log(r.filter((x)=>x.isStreaming===true||x.isBashRunning===true).length);
        } catch { console.log("unknown"); }
      })' || echo unknown)
  if [ "$busy" = "0" ]; then
    log "no runs in flight; restarting"
    break
  fi
  now=$(date +%s)
  if [ $((now - start)) -ge "$wait_timeout_seconds" ]; then
    log "runs still in flight after ${wait_timeout_seconds}s; deferring restart (exit 4)"
    exit 4
  fi
  log "waiting for $busy run(s) to finish (elapsed $(( (now - start) / 60 ))m)"
  sleep "$poll_seconds"
done

# Restart the daemon first so the web process never briefly serves the new
# assets against the old daemon.
systemctl --user restart pi-web-sessiond
systemctl --user restart pi-web

sleep 5
for unit in pi-web-sessiond pi-web; do
  log "$unit: $(systemctl --user is-active "$unit") (pid $(systemctl --user show -p MainPID --value "$unit"))"
done
bundle=$(sed -n 's/.*\/assets\/\(index-[A-Za-z0-9_-]*\.js\).*/\1/p' dist/client/index.html | head -1)
log "bundle on disk: ${bundle:-unknown}"
served=$(curl -fsS --max-time 5 http://127.0.0.1:8504/ 2>/dev/null \
  | sed -n 's/.*\/assets\/\(index-[A-Za-z0-9_-]*\.js\).*/\1/p' | head -1 || true)
log "bundle served:  ${served:-unreachable}"
[ -z "$served" ] || [ "$served" = "$bundle" ] || log "warning: served bundle differs from disk"
log "auto-update finished"