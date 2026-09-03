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

The transcript stops shaking under a streaming reply, message card corners
close, and between 761px and 1180px there is once again a control that switches
workspace tools.
