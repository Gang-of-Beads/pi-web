---
"@gang-of-beads/pi-web": patch
---

The installers, the Updates page's update command and `pi-web doctor` pass `--allow-scripts=node-pty` only when the host's npm knows that option (npm 11.15 and later, and npm 12, which needs it), so updating with npm 11.6 to 11.14 no longer prints npm's "Unknown cli config" warning. An npm that could not be asked still gets the flag.
