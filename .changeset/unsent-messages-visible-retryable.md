---
"@gang-of-beads/pi-web": patch
---

A message caught mid-send when the page closes is no longer invisible. The outbox already kept it; now it renders above the composer as Unsent with Retry and Discard, retries automatically on load and on reconnect, and nothing is ever dropped without an explicit acceptance - an unconfirmed handler answer keeps the message instead of silently clearing it.
