---
"@gang-of-beads/pi-web": patch
---

Large image and file attachments send again. A message's attachments are kept in the browser's IndexedDB while it waits to be sent, instead of in local storage, which could not hold a multi-megabyte image and refused the message with "This browser could not store the message". When local storage is full, cached transcripts and session lists make room before a draft or an unsent message is refused.
