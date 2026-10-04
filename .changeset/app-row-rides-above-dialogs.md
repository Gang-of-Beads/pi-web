---
"@gang-of-beads/pi-web": patch
---

The notice row at the top ("Reconnecting…", a machine that stopped answering, a failed action) now stays visible above an open dialog such as Settings, which moves down to make room. It has no close button any more: a connection notice leaves when the connection is back, and a notice about an action leaves after ten seconds, keeping its Retry while it shows. When a machine's session daemon stops while PI WEB itself keeps running, the row now says "<machine> is unavailable; reconnecting…" instead of staying empty or asking you to reconnect, and the page waits up to five seconds between attempts instead of retrying twice a second, which also kept the logs from filling with failed requests. Reload the page to pick this up.
