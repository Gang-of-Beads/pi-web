---
"@gang-of-beads/pi-web": patch
---

An unsent message shows once. The tray above the composer repeated any outbox entry older than four seconds even while the transcript already showed the same message as "Sending" or "Sent, no answer yet", so one message read as two. The tray now speaks only for a message nothing else shows (one recovered after a reload), and the transcript row carries the actions its state allows: Retry - for that message alone, under the same identity so the daemon deduplicates it - when the answer never came or the server says it never arrived, and Discard once a send has settled without being taken. Rows that need a decision keep their actions visible on desktop, and Retry while offline says the message will send itself when the connection is back instead of doing nothing.
