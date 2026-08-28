#!/usr/bin/env bash
#
# The 8505 test stack: one command to build it, restart it, and prove it is up.
#
# All PI WEB dev and test work happens on 8505. The owner's live instance is
# 8504 with the default data dir, and this script must never be able to touch
# it. So it never kills by process name: a process is an 8505 process only when
# its command line - argv plus environment, as `ps -E` prints it - contains an
# exact match for this stack's data dir, its socket path, or PI_WEB_PORT=8505.
# Anything listening on 8505 without one of those markers is reported and left
# alone, and the script exits non-zero rather than guessing. Ancestors of this
# script are refused as well, so the session daemon hosting whoever runs this
# cannot be stopped by it.
#
# Usage:
#   scripts/stack-8505.sh up [--skip-build]   build, restart, wait for HTTP 200
#   scripts/stack-8505.sh down                stop this stack only
#   scripts/stack-8505.sh status              PIDs and health, no changes
#   scripts/stack-8505.sh seed                write the attribution fixtures
#   scripts/stack-8505.sh check               run the attribution live check
#   scripts/stack-8505.sh clean-seed          delete the seed directories
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8505
DATA_DIR="${PI_WEB_8505_DATA_DIR:-$HOME/.pi-web-8505}"
SOCKET="$DATA_DIR/sessiond.sock"
SESSIOND_TMUX=pi-web-8505-sessiond
WEB_TMUX=pi-web-8505-web
BASE_URL="http://127.0.0.1:$PORT"
READY_TIMEOUT_SECONDS=120

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# argv + environment of one process, which is where the 8505 markers are: the
# markers are set as environment for `node`, so argv alone would not show them.
process_command_line() {
  ps -p "$1" -Eww -o command= 2>/dev/null || true
}

# The guard. Membership of this stack is an exact token match, never a name.
# macOS `ps -E` omits the environment for daemonised children (measured: only
# the bash wrapper matched, the node processes did not), so a second membership
# proof exists: HOLDING this stack's socket or port while running this repo's
# server entrypoint. Resource ownership plus code identity - still never a name.
is_8505_process() {
  if process_command_line "$1" | tr ' ' '\n' | grep -Fxq \
    -e "PI_WEB_DATA_DIR=$DATA_DIR" \
    -e "PI_WEB_SESSIOND_SOCKET=$SOCKET" \
    -e "PI_WEB_PORT=$PORT"; then
    return 0
  fi
  if holder_pids | grep -qx "$1"; then
    process_command_line "$1" | grep -Eq "dist/server/(sessiond|index)\.js"
    return $?
  fi
  return 1
}

# Pids that hold this stack's unix socket or TCP port. The daemon owns only the
# socket (no TCP), so a port scan alone never sees it; asking lsof who holds
# each resource needs no environment visibility at all.
holder_pids() {
  { lsof -t -- "$SOCKET" 2>/dev/null; lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null; } | sort -u
}

# The daemon hosting the session that runs this script is an ancestor of it.
# Refusing ancestors keeps that daemon unkillable here by construction.
is_ancestor_of_self() {
  local pid="$$"
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    if [ "$pid" = "$1" ]; then return 0; fi
    pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')"
  done
  return 1
}

marked_pids() {
  ps -Axww -E -o pid=,command= 2>/dev/null \
    | grep -F -e "PI_WEB_DATA_DIR=$DATA_DIR" -e "PI_WEB_SESSIOND_SOCKET=$SOCKET" \
    | awk '{print $1}' | sort -u
}

port_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u
}

stack_pids() {
  { marked_pids; port_pids; holder_pids; } | sort -u
}

report_pids() {
  local pid
  for pid in $(stack_pids); do
    printf '  pid %-7s %s\n' "$pid" "$(ps -p "$pid" -o command= 2>/dev/null | cut -c1-80)"
  done
}

stop_stack() {
  local pids doomed pid
  pids="$(stack_pids)"
  if [ -z "$pids" ]; then
    echo "no previous 8505 processes"
    return 0
  fi
  doomed=""
  for pid in $pids; do
    # A pid from the lsof/ps snapshot can be gone by the time we ask about it.
    # An empty command line is a dead process, not a stranger: skip it rather
    # than refusing - refusing turned "unreadable" into "unauthorised" once.
    if [ -z "$(process_command_line "$pid")" ]; then
      continue
    fi
    if is_ancestor_of_self "$pid"; then
      echo "REFUSED: pid $pid is an ancestor of this script; not killing anything" >&2
      exit 1
    fi
    if ! is_8505_process "$pid"; then
      echo "REFUSED: pid $pid holds port $PORT but its command line has no 8505 marker" >&2
      echo "         $(process_command_line "$pid" | cut -c1-160)" >&2
      exit 1
    fi
    doomed="$doomed $pid"
  done
  echo "stopping previous 8505 processes:$doomed"
  # shellcheck disable=SC2086
  kill -TERM $doomed 2>/dev/null || true
  local waited=0
  while [ "$waited" -lt 15 ]; do
    if [ -z "$(stack_pids)" ]; then break; fi
    sleep 1
    waited=$((waited + 1))
  done
  for pid in $(stack_pids); do
    if is_8505_process "$pid" && ! is_ancestor_of_self "$pid"; then
      echo "pid $pid did not stop on TERM; sending KILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  # tmux windows are killed by name, and only the two this script owns.
  tmux kill-session -t "$SESSIOND_TMUX" 2>/dev/null || true
  tmux kill-session -t "$WEB_TMUX" 2>/dev/null || true
  # A dead daemon leaves its socket file behind, and a stale socket file makes
  # "the socket exists" - which start_stack waits on - true before the new
  # daemon ever binds. Remove it only once nothing holds it.
  if [ -S "$SOCKET" ] && [ -z "$(lsof -t -- "$SOCKET" 2>/dev/null)" ]; then
    rm -f -- "$SOCKET"
  fi
}

start_stack() {
  mkdir -p "$DATA_DIR"
  tmux new-session -d -s "$SESSIOND_TMUX" -c "$REPO_ROOT" \
    "PI_WEB_DATA_DIR=$DATA_DIR PI_WEB_SESSIOND_SOCKET=$SOCKET node dist/server/sessiond.js"
  tmux set-option -t "$SESSIOND_TMUX" remain-on-exit on >/dev/null
  local waited=0
  while [ ! -S "$SOCKET" ]; do
    if [ "$waited" -ge 30 ]; then
      echo "FAIL: session daemon socket $SOCKET never appeared" >&2
      tmux capture-pane -p -t "$SESSIOND_TMUX" | tail -20 >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  tmux new-session -d -s "$WEB_TMUX" -c "$REPO_ROOT" \
    "PI_WEB_DATA_DIR=$DATA_DIR PI_WEB_SESSIOND_SOCKET=$SOCKET PI_WEB_PORT=$PORT node dist/server/index.js"
  tmux set-option -t "$WEB_TMUX" remain-on-exit on >/dev/null
}

# 200 alone proves someone is serving, not that OUR freshly started processes
# are. A previous stack adopted this way once: the new daemon died on a bind
# conflict, the old one answered the health check, and the check ran against
# stale code. Identity, not liveness: the socket and port holders must be the
# processes the tmux sessions just started (or their descendants).
assert_started_identity() {
  local holder ok pane_pids
  pane_pids="$(tmux list-panes -s -t "$SESSIOND_TMUX" -F '#{pane_pid}' 2>/dev/null; tmux list-panes -s -t "$WEB_TMUX" -F '#{pane_pid}' 2>/dev/null)"
  for holder in $(holder_pids); do
    ok=0
    local pid="$holder"
    while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
      if echo "$pane_pids" | grep -qx "$pid"; then ok=1; break; fi
      pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')"
    done
    if [ "$ok" != "1" ]; then
      echo "FAIL: pid $holder holds this stack's socket/port but was not started by this invocation" >&2
      echo "      $(process_command_line "$holder" | cut -c1-160)" >&2
      echo "      a previous stack survived stop_stack; refusing to adopt it" >&2
      exit 1
    fi
  done
}

http_status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo 000
}

wait_until_ready() {
  local waited=0 app health
  while [ "$waited" -lt "$READY_TIMEOUT_SECONDS" ]; do
    app="$(http_status "$BASE_URL/")"
    health="$(http_status "$BASE_URL/api/sessiond/health")"
    if [ "$app" = "200" ] && [ "$health" = "200" ]; then
      assert_started_identity
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "FAIL: 8505 did not answer 200 within ${READY_TIMEOUT_SECONDS}s (app=$app health=$health)" >&2
  tmux capture-pane -p -t "$WEB_TMUX" 2>/dev/null | tail -20 >&2
  tmux capture-pane -p -t "$SESSIOND_TMUX" 2>/dev/null | tail -20 >&2
  exit 1
}

command_up() {
  if [ "${1:-}" != "--skip-build" ]; then
    echo "building..."
    (cd "$REPO_ROOT" && npm run build >/dev/null)
  else
    echo "skipping build"
  fi
  stop_stack
  start_stack
  wait_until_ready
  echo "8505 processes:"
  report_pids
  echo "tmux sessions: $SESSIOND_TMUX (daemon), $WEB_TMUX (web/API)"
  echo "READY: $BASE_URL answers 200, session daemon healthy on $SOCKET"
}

command_status() {
  local pids
  pids="$(stack_pids)"
  if [ -z "$pids" ]; then
    echo "8505 stack: not running"
  else
    echo "8505 processes:"
    report_pids
  fi
  echo "app    $BASE_URL/                    -> $(http_status "$BASE_URL/")"
  echo "daemon $BASE_URL/api/sessiond/health -> $(http_status "$BASE_URL/api/sessiond/health")"
}

case "${1:-up}" in
  up) command_up "${2:-}" ;;
  down) stop_stack ;;
  status) command_status ;;
  seed) node "$REPO_ROOT/scripts/seed-8505-subagent-attribution.mjs" ;;
  clean-seed) node "$REPO_ROOT/scripts/seed-8505-subagent-attribution.mjs" --clean ;;
  check) node "$REPO_ROOT/scripts/verify-8505-attribution.mjs" ;;
  -h | --help | help) usage ;;
  *)
    echo "unknown command: $1" >&2
    usage >&2
    exit 2
    ;;
esac
