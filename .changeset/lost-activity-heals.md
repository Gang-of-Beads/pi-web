---
"@gang-of-beads/pi-web": patch
---

A session no longer keeps showing as working after its live "finished" update was lost: when the page reads the machine's session states again, it also clears a working mark the states show is over, and it keeps any newer update that arrived while it was reading. A burst of lost updates on a poor connection now costs one round of reads instead of one per loss. Reload the page to pick this up.
