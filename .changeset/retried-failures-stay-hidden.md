---
"@gang-of-beads/pi-web": patch
---

A model error that pi retries automatically no longer shows in the transcript. Only a failure that no retry replaced gets a "Model response failed" row. This applies both live, where the row is taken back when the retry starts, and when the conversation is loaded again. The session list's message count matches what the transcript shows.
