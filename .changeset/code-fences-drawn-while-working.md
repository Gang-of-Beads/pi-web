---
"@gang-of-beads/pi-web": patch
---

Plugins that draw code blocks, such as diagrams or media players, draw them while the session is still working: in earlier replies, and in a reply whose tools are running. Only a reply the agent is still writing waits until its text is complete; before, every claimed block in the conversation stayed plain code until the turn ended (#60). Plugin message buttons also learn which reply is still being written (`row.streaming`), as documented.
