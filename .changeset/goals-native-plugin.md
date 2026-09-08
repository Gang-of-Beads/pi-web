---
"@gang-of-beads/pi-web": patch
---

Goals returns as a native plugin on the plugin architecture: a new
`pi-web-plugins/goals` contributes one quiet drawer section - status dot,
objective clamped to two lines, muted task progress, and a ghost refresh
button sized by the host touch token - fed by a `goals.list` daemon operation
that reads the workspace's `.pi/goals` records (session-cwd overlays included)
and hides itself entirely when no goal exists. The section consumes host
surface styles and tokens instead of shipping its own chrome, and badges the
remaining task count on the drawer tab.
