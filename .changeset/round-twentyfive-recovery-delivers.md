---
"@gang-of-beads/pi-web": patch
---

The recovery the banner promised can now deliver, and the plugin panels get
the floors the shell always gave.

The "interrupted-run status is unknown" banner told the reader to reconnect
to resolve it, but the empty-record guard ran before the retraction - and
after the boot read, emptiness is the only answer a recovery can bring, so
the promise was undeliverable by construction. Any successful read now
clears the unknown state. The unread ring stops wearing the running colour
(a machine row that is unread and working used to be indistinguishable from
one that is just working), the terminals refresh checks the machine the
reader is on before painting a late failure, the plugin-backend failures
keep their machine scope, and the workspace-tasks and relays panels take
the 44px touch floor, the disabled-opacity token and the box-sizing their
siblings always had.

<!-- ERRATUM (round 28): the relays floors shipped nested inside .document-tab.active and matched no element; restored in 0ae86be1's successor. -->
