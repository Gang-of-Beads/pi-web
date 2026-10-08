---
"@gang-of-beads/pi-web": patch
---

The Nix package works on Linux again. Since 2.202610.0 the session daemon exited at startup with "Failed to load native module: pty.node", so the web UI answered every request with 502: the package never compiled node-pty's terminal module on Linux, where node-pty ships no prebuilt copy. The build now compiles it and fails if the module is missing.

Update to pick this up; the session daemon starts on the next switch.
