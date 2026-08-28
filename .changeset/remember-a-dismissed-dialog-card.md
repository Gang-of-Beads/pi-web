---
"@vincenthanxiaodu/pi-web": patch
---

Keep a dismissed extension-dialog card from coming back.

Dismissing a settled dialog card removed it from the list that was also the only
record that the dialog had already been settled here. The daemon's status
projection is unordered against socket frames, so a snapshot built before the
close could arrive after the dismissal, put the dialog back on the open list, and
let the following close record its outcome card a second time — a card the reader
had to dismiss again.

A dismissal is now remembered for as long as the settled cards themselves live,
so a status that predates the close can no longer re-open the dialog. A live
`dialog.opened` frame still shows a card, because an extension asking again is
news the projection cannot be stale about.
