---
"@vincenthanxiaodu/pi-web": patch
---

Stop offering long-dead runs as working agents.

A run directory holds no evidence about whether its child lives until the child
writes something, so the parent conversation was asked instead. But the parent
streaming is a fact about the parent: it says a conversation is busy now, not
that a particular child spawned hours ago is what is keeping it busy. Six
directories left by children that died before writing anything - empty for 158
to 274 minutes - were reported as running agents under the generic name, with no
output and nothing to open, and the drawer went on offering them for hours.

The parent may now vouch only for a child young enough that "it has not written
yet" is still the explanation. Measured across 198 real runs, a child's first
transcript line lands a median of 7s and at most 55s after its directory
appears, so a run still silent five minutes in did not start slowly. Past that
the run is reported as `lost`, which is what this module already calls a child
that stopped without reporting. It keeps its row: hiding these again would
restore the older defect where a working fork child was absent from the list for
as long as it was working.
