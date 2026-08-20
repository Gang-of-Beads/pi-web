#!/usr/bin/env sh
set -eu

npm install -g @vincenthanxiaodu/pi-web --allow-scripts=node-pty
pi-web install
