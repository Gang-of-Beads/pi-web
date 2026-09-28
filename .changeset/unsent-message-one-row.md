---
"@gang-of-beads/pi-web": patch
---

An unsent message shows once. The tray above the composer repeated any outbox entry older than four seconds even while the transcript already showed the same message as "Sending" or "Sent, no answer yet", so one message read as two. The tray now speaks only for a message nothing else shows (one recovered after a reload), and the transcript row carries the actions its state allows: Discard for a send nobody confirmed, and Retry - under the same identity, so the daemon deduplicates it - for one whose answer never came.
