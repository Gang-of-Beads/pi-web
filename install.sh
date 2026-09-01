#!/usr/bin/env sh
set -eu

npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
pi-web install
