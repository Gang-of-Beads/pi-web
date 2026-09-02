---
"@gang-of-beads/pi-web": patch
---

Large tool output no longer weighs down a transcript, and stop reaches compaction

A single transcript page answered a request for a hundred messages with 15.6 MB,
five tool results accounting for two thirds of it. Tool output is now bounded on
its way to the browser - on the page as well as on live events, and on the field
that is actually displayed - cut on whole characters, with the row saying how
much the whole output weighed so a stump is not mistaken for the end of it.

Stopping a session also now ends compaction. The runtime counts itself busy
while compaction runs and offers a way to abort it, which was never called, so a
session stuck compacting ignored the stop button entirely and new prompts could
only queue behind it.
