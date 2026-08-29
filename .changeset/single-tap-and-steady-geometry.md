---
"@vincenthanxiaodu/pi-web": patch
---

A tap on a phone now activates the thing it lands on. `:hover` was styling
elements on every device, and on a coarse pointer the first touch dispatches
hover, changes the appearance, and the browser withholds the click - so an
option or a Dismiss button needed two taps, the first only tinting it. Hover is
now a device capability everywhere in the client, guarded by `@media (hover:
hover)`, with an invariant test so the rule cannot grow back one file at a time.

The drawer's tab strip keeps its membership when a count reaches zero, so the
row no longer reflows and moves content out from under a finger mid-tap.

Answering an extension dialog no longer costs a second tap to put the card
away: the answer settles into one quiet row, and the outcome is filed in the
session's notification drawer where it can be read back.
