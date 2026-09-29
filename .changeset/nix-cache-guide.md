---
"@gang-of-beads/pi-web": patch
---

The README now explains how to install PI WEB with Nix from the public binary cache gang-of-beads.cachix.org. It covers pinning a release tag, trusting the cache, and using the flake's own package with the Home Manager module, so the install downloads instead of compiling. The installation guide's Nix example now does the same.
