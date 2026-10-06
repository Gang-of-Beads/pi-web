---
"@gang-of-beads/pi-web": patch
---

Installing PI WEB from its nix flake works again. Since PI WEB moved to pnpm 12, building the flake failed with `jq: parse error: Invalid numeric literal` while it fetched the dependencies, so a nix install or a nix-config switch that builds PI WEB stopped at that step. Nothing needs restarting; rebuild your nix configuration to pick it up.
