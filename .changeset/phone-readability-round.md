---
"@gang-of-beads/pi-web": patch
---

The phone readability and loop-closure round.

Bar labels sit on an even line box, so a title no longer reads 1px high
and tilted. Session rows are one line with an ellipsis at a uniform
height; the row menu is a bordered single-line list with short labels.
Message headers are one aligned row of bordered 22px controls, slightly
shorter. The scroll meter is a thin rail on the right edge instead of a
bar across the top. A transport failure earns its banner: one blip shows
nothing, a claim still standing after four seconds reads "retrying in
the background" and withdraws when the connection answers; a 5xx is
classified as that transport claim. The phone settings open on a single
title bar and its rows match the list style, with the duplicate General
heading gone. The hamburger opens the menu as an overlay instead of
navigating away from the chat, so returning needs no re-selection.
