---
"@vincenthanxiaodu/pi-web": patch
---

A queued message is drawn once. Only bubbles already marked queued were matched against the server's queue, so a message still marked sending — the state it holds between leaving the browser and the next status frame — was drawn a second time beside itself.

The drawer's sections stay reachable on a narrow screen. They refused to shrink, so the selected one scrolled into view and took the others out of sight, which read as the strip disappearing.
