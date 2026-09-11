---
"@gang-of-beads/pi-web": patch
---

Deliver the Round C fixes to readers, and complete the pressed-state
family on shared list rows.

The plugin bundle served to readers predated the Round C commit by five
minutes, so the tasks viewer's centering fix and the goals refresh rule
never shipped - dist is rebuilt with both. The project, workspace and
machine rows in the navigation panel and context sheet take the coarse
pressed state through the shared list styles (session rows already had
it in their own shadow). The desktop rail header takes the same vertical
breathing as the context bar, so the two header rows across the divider
are symmetric again, and the queued-message header joins the solid
divider rule.
