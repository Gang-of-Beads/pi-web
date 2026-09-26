---
"@gang-of-beads/pi-web": patch
---

A message the daemon has is no longer offered as unsent.

The send call and the daemon acceptance frame are two reports of one fact, and
on a phone over a tailnet both can go missing while the message itself arrives.
The outbox then kept an "Unsent / Retry / Discard" row under a running turn with
the message visible in the transcript above it - the reader: 既然是 running 怎么
可能还有 retry/discard.

The transcript is the proof that needs no frame: a delivered message carries the
id the browser minted, so a stored outbox entry whose id is settled is retired.
