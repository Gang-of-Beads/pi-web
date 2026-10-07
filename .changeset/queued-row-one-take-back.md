---
"@gang-of-beads/pi-web": patch
---

A queued message now has one take-back key, Recall, which takes it out of the queue and back into the composer. The "Edit and send again" key no longer sits beside it: it copied a message that was still waiting to go, so using it sent the message twice. Reload the page to pick it up.
