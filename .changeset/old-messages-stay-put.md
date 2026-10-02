---
"@gang-of-beads/pi-web": patch
---

An old message no longer comes back by itself. When the page loads, reconnects or switches sessions, it now resends on its own only a message that was not sent in the last ten minutes. A message whose delivery could not be confirmed, or anything older, waits for you to press Retry or discard it. Before, a message stuck for hours was sent again the next time the page loaded. A browser reload picks this up.
