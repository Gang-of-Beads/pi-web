#!/usr/bin/env sh
set -eu

usage() {
  printf '%s\n' 'Usage: install.sh [--preset gang-of-beads]' >&2
  exit 2
}

preset=
case "$#" in
  0) ;;
  2)
    [ "$1" = '--preset' ] && [ "$2" = 'gang-of-beads' ] || usage
    preset="$2"
    ;;
  *) usage ;;
esac

if [ -n "$preset" ] && ! command -v pi >/dev/null 2>&1; then
  printf '%s\n' 'The Gang of Beads preset requires Pi Coding Agent on PATH. Install and configure Pi first.' >&2
  exit 1
fi

npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty

if [ -n "$preset" ]; then
  for source in \
    npm:@gang-of-beads/pi-ask-user \
    npm:@gang-of-beads/pi-subagents \
    npm:@gang-of-beads/pi-web-subagents \
    npm:pi-background-tasks \
    npm:@gang-of-beads/pi-web-background-runs \
    npm:@gang-of-beads/pi-goal \
    npm:@gang-of-beads/pi-web-goals \
    npm:@gang-of-beads/pi-web-themes \
    npm:@gang-of-beads/pi-multi-account \
    npm:@gang-of-beads/pi-updater
  do
    pi install "$source" </dev/null
  done
fi

pi-web install
