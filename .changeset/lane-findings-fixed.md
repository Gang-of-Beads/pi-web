---
"@gang-of-beads/pi-web": patch
---

Review-lane findings from the dead-session and chrome-selection wave.

The dead-session skip lived in one producer; the archive, delete,
cleanup, refresh and cached-new flows could still auto-pick a dead
session and re-raise the notice the wave removed - all five now share
one isOpenableSession predicate, and a workspace reduced to only dead
rows deselects honestly instead of raising a banner. A dead row keeps
its bulk-select gutter and unread indicator like every other row. The
attachment error line is copyable again, the session search input
re-enables selection against the panel's chrome no-select rule, and the
composer's selection test now asserts the contenteditable clause the
component actually renders.
