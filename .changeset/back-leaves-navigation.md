---
"@gang-of-beads/pi-web": patch
---

Back leaves the navigation page.

The page pushed a history frame when it opened but nothing answered the
gesture, so the browser and phone back button looked dead on it. Back now
closes it and returns to the session it was opened from; a dialog opened over
the page still answers first.
