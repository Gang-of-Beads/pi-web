---
"@gang-of-beads/pi-web": patch
---

A message reading "Receiving…" keeps checking with the server while the connection is down, instead of giving up after three tries. The top of the page says "Reconnecting to update message status…" until a check gets through; the message then shows what the server knows about it.
