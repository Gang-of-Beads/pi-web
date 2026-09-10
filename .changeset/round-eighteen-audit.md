---
"@gang-of-beads/pi-web": patch
---

The convergence lanes audited the previous round's fixes and caught two that
were never landed. The self-update banner's coarse 44px floor is now really
above the media block that raises it, and the pointer-query guard really
checks the first rule of every media block - proven by turning the broken
order red before turning it green.

The phone header no longer mounts a second, visible machine list next to the
panel's own; the state rail's unread row class no longer paints working rows
purple over a blue dot, and the background state plus the machine unread dot
joined the same purple vocabulary. Error reporting now always travels with
its retirement mark and machine scope - a stale scope could let one machine's
success erase another's complaint, and self-update failures could inherit a
stranger's expiry. The interrupted-runs "status unknown" banner only
announces onto a quiet screen and retracts itself when the read recovers.
The quick switcher's row menu is fixed and viewport-constrained like every
other row menu, and the session tree's disclosure and close buttons got
their coarse touch floors.
