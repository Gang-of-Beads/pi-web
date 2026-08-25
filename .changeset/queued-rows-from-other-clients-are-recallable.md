---
"@vincenthanxiaodu/pi-web": patch
---

Let a queued message sent by another client be recalled. A message queued over the API or by a different browser carries no clientMessageId, so its synthesized transcript row fell back to a `queued:kind:text` key that never matched the server's queue: the row was drawn as an ordinary user message - no gold waiting mark, no recall action - even though the server's recall accepts such entries by kind and text. The row is now matched against the queue the same way the server recalls it.
