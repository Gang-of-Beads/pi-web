---
"@gang-of-beads/pi-web": patch
---

The cwdMissing stamp actually reaches the wire, and the heading wrap ships.

Erratum to the earlier changeset: the daemon stamped list entries, but the
mapper that rebuilds each row for the client dropped the field, so the
"folder gone" gate never fired and dead sessions still opened into the
daemon's load error. The stamp now crosses to the client (regression test
pins the wire), and the sessions heading wrap - recorded as fixed in the
pro-phone triage but never written - is actually in.
