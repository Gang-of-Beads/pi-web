---
"@gang-of-beads/pi-web": patch
---

A message never fails any more. It reads "Sending…" until the machine has it, and is sent again by itself, with the same identity, until it arrives - there is no "Not received", no Retry and no Discard. Messages from one device reach the agent in the order they were written: each message and each take-back carries a number in that device's log, the machine applies them in number order, and a later message can no longer be queued ahead of an earlier one still on its way. A message on its way or queued has one Take back key; its words come back to the composer once the machine confirms, or a notice says the agent already has it. A message's time is the moment the agent got it; a waiting message shows no clock. The session daemon must be restarted, and pages and machines updated together: a message without its number is refused.
