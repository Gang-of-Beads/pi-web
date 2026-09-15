---
"@gang-of-beads/pi-web": patch
---

Slash commands read like messages.

A typed or button-issued command now shows as a user bubble carrying the
command text, its result beneath it, and the same delivery mark a sent
message wears: Queued while the daemon holds it for after the current
reply, Running while it executes, Read once it ran, Not sent when it
refused or the reader closed its question unanswered. The daemon now says
when a result is deferred, so a forwarded command or a parked reload is
never marked Read before it runs, and the mark settles once the session
goes idle. The warning-coloured receipt strip and its dismiss button are
gone, and the result is no longer injected into the transcript a second
time. This mirrors pi: a built-in command is not a message and writes no
transcript entry, so the model never sees it; a runtime command is
forwarded to the agent and streams back as its own message.
