---
"@gang-of-beads/pi-web": patch
---

Messages survive, live surfaces refresh, and panels say what they know.

A message is durable from the moment you send it: it enters the outbox before
the request rather than inside the catch of a settled failure, so closing the
page mid-send no longer loses it without a trace, and it carries one identity
from the composer through delivery so a retry revives the bubble you already see
instead of adding a second one.

The activity list refreshes when the daemon says it changed. The signal was
computed, compared and invoked, and nothing ever supplied an implementation for
it, so the tab counted running work above a list that claimed nothing was
running.

A connection that stalls recovers by itself. A socket stuck mid-handshake was
examined by nothing - no open event, no close event, no scheduled reconnect - so
the only way back was the manual refresh; and dropping a dead socket detached
the very handler that would have reconnected it.

Panels stop overstating what they know. Compaction qualifies the activity chip
instead of replacing it, so a streaming reply no longer reads as stopped. A
session between two tool calls is no longer reported as done. The activity panel
names the two things it can see rather than declaring the session quiet. A
subagent run that has not reported says so, instead of "Unknown" beside "Lost".

Sending a message while questions are open no longer closes them: every question
carries a Custom answer, so a remark is an addition, not a withdrawal.

A queued message whose turn ended before it was handed over is sent outright
instead of parked where nothing would drain it - the "Sent, and then nothing"
report, and the same fault seen from the other side as a message consumed out
of order long after it was sent. Recalled-message replay takes the same
decision at the moment of submission.

A goals panel that has read nothing can start a read: "not read yet" no longer
renders as "Loading goals…" with the refresh control disabled, and the drawer's
panel - the one a phone uses - has a working refresh at all.

A session whose branch carries a thinking block the provider refuses says why
every retry fails the same way, instead of a bare 400 that reads as random.

Renaming a session uses the project's own dialog; the native prompt() it
replaces is suppressed in iOS standalone mode, so on a phone the control could
do nothing at all.

Ask-form option rows meet the coarse-pointer floor, and the Custom row carries
a drawn divider, so a thumb's few pixels of drift stop answering Custom.

The transcript stops shaking under a streaming reply, message card corners
close, and between 761px and 1180px there is once again a control that switches
workspace tools.
