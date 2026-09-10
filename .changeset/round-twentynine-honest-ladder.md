---
"@gang-of-beads/pi-web": patch
---

A load start is not a retirement event, and the failed-listing ladder
stops promising reconnects it never performs.

Machine switches and browser resume both pass through the projects load,
whose first act silently cleared any reader-retired failure banner -
exactly the eating the round-28 owner decision forbade - so the clear is
gone and a load beginning no longer counts as a retirement event. The
boot ladder for a local deep link no longer borrows the machine wording
("reconnecting…" from a machine that was never probed) and no longer dies
at its first retry: it retriesthe projects listing itself, which is the
whole recovery, and its still-current guard accepts the local machine.
Also: the coarse session row reserves the gutter its toggle actually
draws, the hidden-attribute guard now sees the machine list and property
bindings, and the interrupted-runs retraction is scoped to the machine
whose read raised it.
