#!/usr/bin/env bash
#
# install-or-update pi-web from the latest GitHub Release tarball.
#
# The fork publishes pre-built npm-pack tarballs (dist included) on every
# main push (see .github/workflows/auto-release.yml). This script keeps a
# deployment in ~/pi-web-release/<tag> with a `current` symlink, so machines
# do not need git or a toolchain to run the latest build.
#
# Usage: release-update.sh [--apply]
#   default: download + verify + stage, report what would change
#   --apply: stage, switch the symlink, and restart the local services
#
# Services are restarted via systemd (Linux) or launchctl (macOS).
set -euo pipefail

REPO="VincentHanxiaoDu/pi-web"
BASE="${PI_WEB_RELEASE_BASE:-$HOME/pi-web-release}"
CURRENT="$BASE/current"
API="https://api.github.com/repos/$REPO/releases/latest"

apply=false
for arg in "$@"; do
  [ "$arg" = "--apply" ] && apply=true
done

mkdir -p "$BASE"

release_json="$(curl -fsSL --max-time 20 "$API" 2>/dev/null || echo '{}')"
tag="$(printf '%s' "$release_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name",""))' 2>/dev/null || true)"
asset_url="$(printf '%s' "$release_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("assets",[{}])[0].get("browser_download_url",""))' 2>/dev/null || true)"
if [ -z "$tag" ] || [ -z "$asset_url" ]; then
  echo "no release found ($API)" >&2
  exit 1
fi

echo "release: $tag"
echo "asset:   $asset_url"

target="$BASE/$tag"
staged="$BASE/.staging-$tag"

if [ -d "$target" ]; then
  echo "already installed: $target"
  current_tag="$(basename "$(readlink -f "$CURRENT" 2>/dev/null || echo none)")"
  if [ "$current_tag" = "$tag" ] && [ -d "$target/node_modules/@earendil-works/pi-coding-agent" ]; then
    echo "current already points at $tag; nothing to do"
    exit 0
  fi
else
  echo "downloading…"
  rm -rf "$staged"
  mkdir -p "$staged"
  tmp="$(mktemp "$staged/tarball.XXXXXX.tgz")"
  curl -fsSL --max-time 300 -o "$tmp" "$asset_url"
  tar -xzf "$tmp" -C "$staged"
  # npm pack tarballs unpack to a `package/` directory.
  [ -d "$staged/package" ] || { echo "unexpected tarball layout" >&2; exit 1; }
  mv "$staged/package" "$target"
  rm -rf "$staged" "$tmp"
  echo "staged: $target"
fi

entrance="$target/dist/server/index.js"
[ -f "$entrance" ] || { echo "missing $entrance" >&2; exit 1; }

# The npm-pack tarball ships dist/ but no dependencies. Without this step the
# services crash-loop on ERR_MODULE_NOT_FOUND (fastify, @earendil-works/*).
if [ ! -d "$target/node_modules/fastify" ] || [ ! -d "$target/node_modules/@earendil-works/pi-coding-agent" ]; then
  echo "installing runtime dependencies in $target"
  (
    cd "$target"
    # --ignore-scripts: the packed tree has no scripts/ dir, so the `prepare`
    # hook (install-git-hooks.mjs) would fail the install.
    npm install --omit=dev --ignore-scripts --no-audit --no-fund
    # The pi agent packages are peer+dev deps, so --omit=dev skips them even
    # though the server imports them at runtime. Pin them to the pi version
    # installed on this host when it is resolvable, else to the declared range.
    pi_version="$(pi --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    if [ -z "$pi_version" ]; then
      pi_version="$(python3 -c 'import json;d=json.load(open("package.json"));print(d["devDependencies"]["@earendil-works/pi-coding-agent"].lstrip("^~"))' 2>/dev/null || true)"
    fi
    [ -n "$pi_version" ] || { echo "cannot determine pi agent version" >&2; exit 1; }
    echo "pi agent packages: $pi_version"
    npm install --no-save --ignore-scripts --no-audit --no-fund \
      "@earendil-works/pi-coding-agent@$pi_version" \
      "@earendil-works/pi-agent-core@$pi_version" \
      "@earendil-works/pi-ai@$pi_version"
    # node-pty is native and was skipped by --ignore-scripts.
    npm rebuild node-pty
  )
fi

if [ "$apply" != true ]; then
  echo "ready to activate (run with --apply): $target"
  exit 0
fi

echo "switching $CURRENT -> $tag"
ln -sfn "$target" "$CURRENT.swap" && mv -Tf "$CURRENT.swap" "$CURRENT" 2>/dev/null || ln -sfn "$target" "$CURRENT"

# Prefer the nix-profile node: it is the one home-manager keeps in sync and
# it stays on a non-interactive PATH-free systemd exec line.
node_bin=""
for candidate in "$HOME/.nix-profile/bin/node" "$(command -v node || true)" "$HOME/.nvm/versions/node/v24.13.1/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    node_bin="$candidate"
    break
  fi
done
[ -n "$node_bin" ] || { echo "no usable node found" >&2; exit 1; }
echo "node: $node_bin"

# Do not cut short someone's run: wait for in-flight runs before restarting,
# same contract as scripts/auto-update.sh.
wait_for_idle() {
  local api=http://127.0.0.1:8504/api/machines/local
  local start busy now
  start=$(date +%s)
  while true; do
    busy=$(curl -fsS --max-time 5 "$api/sessions/statuses" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          try { const r = JSON.parse(s).statuses ?? [];
            console.log(r.filter((x)=>x.isStreaming===true||x.isBashRunning===true).length);
          } catch { console.log("unknown"); }
        })' || echo unknown)
    # unknown = server down or unreachable; nothing to protect, restart now.
    if [ "$busy" = "0" ] || [ "$busy" = "unknown" ]; then
      return 0
    fi
    now=$(date +%s)
    if [ $((now - start)) -ge "${PI_WEB_DRAIN_TIMEOUT:-21600}" ]; then
      echo "runs still in flight after $((now - start))s; deferring restart" >&2
      exit 4
    fi
    echo "waiting for $busy run(s) to finish (elapsed $(( (now - start) / 60 ))m)"
    sleep 10
  done
}

restart_services() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user restart pi-web-sessiond pi-web
  elif command -v launchctl >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/com.pi-web.sessiond" 2>/dev/null || true
    launchctl kickstart -k "gui/$(id -u)/com.pi-web.web" 2>/dev/null || true
  else
    echo "no systemctl/launchctl; restart pi-web services manually" >&2
  fi
}

wait_for_idle

echo "pointing services at $CURRENT"
sd="$HOME/.config/systemd/user"
if [ -f "$sd/pi-web.service" ] && command -v systemctl >/dev/null 2>&1; then
  # Override ExecStart to run from the release directory. No shell wrapper:
  # the node binary is absolute, so systemd can exec it directly.
  mkdir -p "$sd/pi-web.service.d" "$sd/pi-web-sessiond.service.d"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s %s/dist/server/index.js\n' "$CURRENT" "$node_bin" "$CURRENT" \
    > "$sd/pi-web.service.d/release.conf"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s %s/dist/server/sessiond.js\n' "$CURRENT" "$node_bin" "$CURRENT" \
    > "$sd/pi-web-sessiond.service.d/release.conf"
  systemctl --user daemon-reload
elif [ -f "$HOME/Library/LaunchAgents/com.pi-web.web.plist" ]; then
  # macOS: rewrite the launchd plists to point at the release directory.
  for unit in sessiond web; do
    script="$([ "$unit" = sessiond ] && echo sessiond || echo index)"
    plist="$HOME/Library/LaunchAgents/com.pi-web.$unit.plist"
    python3 - "$plist" "$node_bin" "$CURRENT" "$script" <<'PY'
import plistlib, sys
path, node, current, script = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(path, "rb") as fh:
    d = plistlib.load(fh)
d["ProgramArguments"] = [node, f"{current}/dist/server/{script}.js"]
d["WorkingDirectory"] = current
with open(path, "wb") as fh:
    plistlib.dump(d, fh)
PY
  done
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-web.sessiond.plist" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-web.web.plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-web.sessiond.plist"
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-web.web.plist"
fi

restart_services
echo "done: $(readlink "$CURRENT")"