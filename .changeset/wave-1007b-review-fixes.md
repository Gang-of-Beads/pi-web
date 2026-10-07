---
"@gang-of-beads/pi-web": patch
---

Fixes from reviewing the update-command and extension-page changes:

- A saved update command is no longer lost when you save another setting in the same Settings visit.
- Settings no longer jumps to the update command field on a later visit.
- An extension's page in Go to now survives a reload, even when its widget's name has capitals or spaces.
- An extension whose plugin page isn't loaded keeps its own key instead of disappearing.
- A widget that fails to draw still gets its key.
- Go to now says so when a page isn't available, instead of doing nothing.
- `nix profile` installs on Nix older than 2.20 are recognised.
- The bottom line no longer leaves a double gap when no status fits.

Restart the session daemon and reload the page to pick these up.
