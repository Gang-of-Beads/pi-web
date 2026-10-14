---
"@gang-of-beads/pi-web": patch
---

The `/pi-web` commands load again where the Pi extension is linked into `~/.pi/agent/extensions`, as the Nix and Home Manager installs do. In 2.202610.10 the extension imported a package that does not resolve from there, so it failed to load and every session daemon logged "Cannot find module 'undici'".
