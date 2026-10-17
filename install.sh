#!/usr/bin/env sh
set -eu

usage() {
  printf '%s\n' 'Usage: install.sh [--preset gang-of-beads]' >&2
  exit 2
}

refuse() {
  printf '%s\n' "$@" 'See https://github.com/Gang-of-Beads/pi-web/blob/main/docs/install.md#requirements' >&2
  exit 1
}

has() {
  command -v "$1" >/dev/null 2>&1
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

termux=
[ -n "${TERMUX_VERSION:-}" ] && [ "${PREFIX:-}" = /data/data/com.termux/files/usr ] && termux=1

if ! { has node && has npm; }; then
  [ -z "$termux" ] || refuse 'PI WEB needs Node.js 22.19.0 or newer and npm on PATH.' 'On Termux, install them with `pkg install nodejs`.'
  refuse 'PI WEB needs Node.js 22.19.0 or newer and npm on PATH.'
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' \
  || refuse "PI WEB needs Node.js 22.19.0 or newer; this is $(node --version)."

npm_prefix=$(npm prefix -g)
npm_target="$npm_prefix/lib/node_modules"
while [ ! -d "$npm_target" ]; do npm_target=$(dirname "$npm_target"); done
[ -w "$npm_target" ] || refuse \
  "npm installs global packages into $npm_prefix, which your user cannot write to." \
  'Use a Node.js version manager (nvm, fnm, mise), or run `npm config set prefix ~/.local`, put ~/.local/bin on your login-shell PATH, and run this installer again. Do not run it with sudo.'

if [ -n "$termux" ]; then
  missing=
  has make || missing="$missing make"
  has python3 || missing="$missing python"
  has c++ || missing="$missing clang"
  has sv || missing="$missing termux-services"
  [ -z "$missing" ] || refuse 'On Termux, npm builds the terminal native module (node-pty) with python, make and clang, and `pi-web install` runs the services with termux-services.' \
    "Install them first: pkg install$missing" \
    'After installing termux-services, open a new Termux session so its supervisor starts, then run this installer again.'
elif [ "$(uname -s)" = Linux ] && ! { has make && has python3 && { has c++ || has g++; }; }; then
  refuse 'On Linux, npm builds the terminal native module (node-pty) during the install and needs python3, make and a C++ compiler.' \
    'Install them first, for example `sudo apt install build-essential python3` or `sudo dnf install gcc-c++ make python3`.'
fi

if [ -n "$preset" ] && ! has pi; then
  refuse 'The Gang of Beads preset requires Pi Coding Agent on PATH. Install and configure Pi first.'
fi

if [ -n "$termux" ] && [ ! -e "$HOME/.gyp/include.gypi" ]; then
  mkdir -p "$HOME/.gyp"
  printf '%s\n' "{'variables':{'android_ndk_path':''}}" > "$HOME/.gyp/include.gypi"
  printf '%s\n' "Wrote $HOME/.gyp/include.gypi: node-gyp needs android_ndk_path defined to build node-pty on Termux."
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
    npm:@gang-of-beads/pi-web-voice \
    npm:@gang-of-beads/pi-web-themes \
    npm:@gang-of-beads/pi-multi-account \
    npm:@gang-of-beads/pi-updater
  do
    pi install "$source" </dev/null
  done
fi

pi-web install
