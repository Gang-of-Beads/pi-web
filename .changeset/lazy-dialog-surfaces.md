---
"@gang-of-beads/pi-web": patch
---

The dialogs you have not opened no longer ship with first paint. Settings, the
quick switcher and the session tree were part of the entry bundle every visit
paid for; they are now separate modules, fetched once the app is past boot and
awaited at the moment something opens them. The entry bundle went from
1,021,012 to 781,205 bytes. Opening waits for its own module rather than
rendering an empty frame, because a dialog that appears blank claims to have
nothing in it, while one that appears a moment later is merely slow.
