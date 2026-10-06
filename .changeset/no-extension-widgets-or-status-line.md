---
"@gang-of-beads/pi-web": patch
---

Extensions' `setWidget` boxes and `setStatus` texts are no longer drawn: the box above the message box (such as pi-goal's "Goal focus required") and the extension status line above the session's numbers are gone, as before 2026-10-05. Both calls are pi's headless no-ops again; the working row, folded-thinking label and tab title an extension sets still apply. Restart the session daemon and reload the page.
