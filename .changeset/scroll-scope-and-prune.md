---
"@vincenthanxiao/pi-web": patch
---

A saved reading position carries its machine, and the ones for sessions that are gone
are dropped.

The key was the bare session id, so the same session under two machines shared one
position, and nothing ever evicted a key: `removeItem` existed and was never called, so
a deleted session left its entry in localStorage forever. The key now carries the
machine, and the positions are pruned against the sessions the machine actually lists.
