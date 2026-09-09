---
"@gang-of-beads/pi-web": patch
---

Round five was almost entirely "the previous sweep did not reach here", so the
sweeps are now guarded: font weights and the disabled-state opacity fail the
suite as literals, the way radii, sizes, spacing, dots and token references
already do. The action palette and auth dialog state their own type instead of
the browser's, the auth dialog gets the coarse floor every sibling dialog has,
settings checkboxes read `--pi-checkbox-size` rather than shipping 14, 16 and
18px targets, and close controls in the quick switcher, auth dialog and context
sheet follow the same two-step sizing as the rest of the family. The chat
drawer's collapse control reads the panel-header control height its left-rail
peer uses, message-card headers dock at the same offset as their siblings, the
workspace view rows derive their height, the tile menu derives its inset, and
the drawer no longer draws a second 1px rule under the first.
