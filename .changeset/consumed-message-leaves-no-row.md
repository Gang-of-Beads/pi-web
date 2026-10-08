---
"@gang-of-beads/pi-web": patch
---

A message an extension's input handler or command takes without writing it to the conversation no longer stays "Received" under later messages until a reload: its row goes as soon as the session daemon says the message was consumed, and asking again after a dropped connection gets the same answer. Restart the session daemon.
