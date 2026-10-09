---
"@gang-of-beads/pi-web": patch
---

A Stop is drawn after a reload where it was drawn live. A Stop pressed while pi compacted the history after a finished reply now settles when the compaction ends, instead of showing its row only when the next message was sent. A Stop that settled on its own (during a retry wait, say) no longer moves onto a later turn's failed reply after a reload. Restart the session daemon.
