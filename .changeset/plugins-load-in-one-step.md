---
"@gang-of-beads/pi-web": patch
---

Sessions open faster on a slow connection. Each built-in browser plugin now loads as a single file, where before the page fetched about seventy files one after another before it could open a session. With a 100 ms round trip, as over a tailnet, the first message of a linked session now appears after about 1.4 s instead of 2.4 s. A browser reload picks this up after the update.
