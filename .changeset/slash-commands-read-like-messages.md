---
"@gang-of-beads/pi-web": patch
---

Slash commands read like messages.

A typed or button-issued command now shows as a user bubble carrying the
command text, its result beneath it, and the same delivery mark a sent
message wears: Queued while a reply streams, Running when idle, Read once
the daemon ran it, Not sent when it refused. The warning-coloured receipt
strip and its dismiss button are gone, and the result is no longer injected
into the transcript a second time. This mirrors pi: a command is not a
message and writes no transcript entry, so the model never sees it.
