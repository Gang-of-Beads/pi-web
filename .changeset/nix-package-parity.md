---
"@gang-of-beads/pi-web": patch
---

The Nix package now starts terminals on macOS and ships the `/pi-web` extension. Its node-pty spawn helper was not executable, so every terminal failed with "posix_spawnp failed", and `extensions/` was left out of the package.
