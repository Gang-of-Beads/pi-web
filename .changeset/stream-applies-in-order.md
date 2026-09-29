---
"@gang-of-beads/pi-web": patch
---

A session's live updates now apply once each and in order when some arrive late or out of order: an update published just before you opened the session, or one missed while the page was catching up, is fetched and put back in its place instead of being skipped or applied twice.
