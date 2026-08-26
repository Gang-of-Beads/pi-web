---
"@vincenthanxiaodu/pi-web": patch
---

Keep the transcript in the order the messages were made

Messages were appended as they arrived, and a streaming reply arrives only once
it has finished. Send something while one is in flight and your own message was
appended first, so the reply that started before you typed sat underneath it:
the transcript claimed you spoke first when the record said otherwise.

Arriving messages are now placed by the timestamp they carry. Messages sharing
a timestamp keep arrival order, and a message carrying none is appended rather
than guessed at, so nothing is reordered on no evidence.
