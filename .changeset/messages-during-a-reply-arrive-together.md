---
"@gang-of-beads/pi-web": patch
---

Messages you send while a reply is still streaming now reach the model together at its next step, in the order you sent them. Before, they could be split across several separate requests, each answered on its own. A message the agent has been given but not yet read also survives a session daemon crash: after the restart it is delivered once, never twice and never lost. The session daemon needs a restart for this.
