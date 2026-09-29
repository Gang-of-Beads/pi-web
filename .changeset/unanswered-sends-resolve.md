---
"@gang-of-beads/pi-web": patch
---

A message whose send got no answer no longer waits forever: pi-web asks the session daemon what became of it 5, 15 and 45 seconds later and again when you come back to the tab, then shows it as received, takes it back if it was withdrawn, or offers Retry if the daemon never got it. A message the agent refuses after the daemon accepted it now says so on its own row instead of staying "Queued".
