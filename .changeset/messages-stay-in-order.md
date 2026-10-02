---
"@gang-of-beads/pi-web": patch
---

Messages that are still waiting stay in the order you sent them. A message whose send could not be confirmed is no longer drawn above a queued message you sent before it: every message the agent has not taken yet sits below the conversation, the queued ones first in the order the agent will read them, then the rest by the time you sent them. A browser reload picks this up.
