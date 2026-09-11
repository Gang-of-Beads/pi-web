---
"@gang-of-beads/pi-web": patch
---

A failed interrupted-runs read at cold boot stays quiet.

The unknown-state banner was raised on every failed read, including the
first one at boot - over a slow link the reader got a red "status is
unknown" banner over an otherwise empty screen, before anything was on
display to lose. The record is unread at that point, not lost: the next
successful read delivers it without a banner. The banner now appears only
when a machine that already read successfully fails again - that is when
markers the reader may be watching are genuinely in question.
