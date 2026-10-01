---
"@gang-of-beads/pi-web": patch
---

Messages you send while a reply is still streaming now reach the model together at its next step, in the order you sent them. Before, they could be split across several separate requests, each answered on its own. A message the agent has been given but not yet read also survives a session daemon crash: after the restart it is delivered, once. A message you took back just before the crash stays taken back, and a slash command is never run twice. Only a message sent by a client without message ids, read at the very moment of the crash, can be delivered a second time. A message you send again with the same words as an earlier one is listed as queued, and can be taken back, while it waits. The session daemon needs a restart for this.
