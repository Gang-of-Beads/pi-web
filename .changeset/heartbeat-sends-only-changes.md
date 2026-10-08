---
"@gang-of-beads/pi-web": patch
---

A working session no longer sends its whole status to every open page every two seconds when nothing in it changed. On a long tool call this was about 1.7 KB every two seconds on the session's connection and again on every machine connection; now a status goes out only when something in it changed. Restart the session daemon to pick it up.
