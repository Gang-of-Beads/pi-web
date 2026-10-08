---
"@gang-of-beads/pi-web": patch
---

Opening an unread session no longer moves its row. Before, the session counted as read the moment it opened, and the list animated the row you had just tapped down past the others. Now it keeps its place in the session list and the quick switcher while you have it open, and moves to its read place when you open another session or close it. Restart the web service to pick it up.
