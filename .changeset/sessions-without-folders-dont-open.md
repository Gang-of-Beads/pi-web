---
"@gang-of-beads/pi-web": patch
---

Sessions whose folder is gone no longer open into a red banner.

Opening a session whose stored working directory had been deleted navigated
first and failed after: a red banner over a dead transcript, the one shape
the owner rejected. The daemon now stats each listed session's folder - the
machine that owns the directory answers for it - and stamps the row, so the
list renders "folder gone" where the unread badge would sit, the row cannot
open, and the quick switcher stops offering it. Deep links and keyboard
paths that route through selectSession get the fact as a notice instead of
a navigation into failure; the transcript-failed state remains for the race
where the folder disappears between listing and click.
