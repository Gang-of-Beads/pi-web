---
"@gang-of-beads/pi-web": patch
---

Round six, lane A. The phone panel header measured 53px where the desktop rail
and the resident bar measure 45; it reads the same panel-header height they do.
Informational text moves off `--pi-dim` (4.12:1 on the page) onto `--pi-muted`
(6.15:1): the status readout, the "showing messages X–Y of Z" boundary, the
delivery mark and the session search placeholder are things a reader needs, not
decoration. The load-earlier control and the empty-transcript button meet the
control heights their neighbours already have, the chat drawer's header shares
its body's gutter so the tab strip lines up with the cards below it, and the
message meta control is 24px square like the actions beside it.
