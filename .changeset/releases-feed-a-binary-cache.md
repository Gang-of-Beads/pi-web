---
"@gang-of-beads/pi-web": patch
---

Releases now feed a public binary cache. The publish workflow pushes the Nix builds - including an aarch64-linux build made under emulation - to gang-of-beads.cachix.org, so machines substitute binaries instead of compiling each release themselves; the Raspberry Pi stops spending an hour rebuilding what CI already built.
