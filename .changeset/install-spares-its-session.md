---
"@gang-of-beads/pi-web": patch
---

`pi-web install` run from a PI WEB chat, including by an update or a Nix switch started there, no longer restarts the session daemon under the conversation. The daemon keeps the previous build and says so. Run `pi-web restart` from a terminal outside PI WEB to move it to the new one.
