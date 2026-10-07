---
"@gang-of-beads/pi-web": patch
---

Extension statuses set with pi's `ctx.ui.setStatus` (for example ponytail's mode or pi-goal's focus) are shown again in the session's bottom line, as pi's terminal shows them. The line reads, from the left: tokens in and out, the context, the statuses, and the cost at the right edge. Statuses are cut with "…" when the line runs out of room and left out when there is no room for them, as on a phone with long numbers. Hover the line to see them in full. Extension boxes set with `setWidget` are still not drawn. Restart the session daemon and reload the page to pick it up.
