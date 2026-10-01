---
"@gang-of-beads/pi-web": patch
---

A message waiting to hear back from the server no longer raises a red "Reconnecting to update message status…" notice with a Retry button. The message keeps saying "Receiving…", and if the connection does not come back within a moment, the status bar at the top shows "Reconnecting…" in the same style as other connection problems. It goes away once the server answers. Reload the page to pick this up.
