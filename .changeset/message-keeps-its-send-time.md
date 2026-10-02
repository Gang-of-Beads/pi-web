---
"@gang-of-beads/pi-web": patch
---

A message keeps the time it was sent. Every device, and the same page after a reload, shows the moment its sender pressed send; it no longer changes to the moment the agent read it, which made messages sent during a reply all show the same later time. A message retried from the outbox keeps the time it was first sent.

The session daemon needs a restart for this, then a browser reload.
