---
"@gang-of-beads/pi-web": patch
---

A subagent's question card now says whether your reply reached the subagent. After you send a reply it says it is waiting for the agent to relay it; once pi-subagents records the reply as delivered, it says "Delivered to <agent>", including for a reply you wrote in the composer instead of the card. Before, the card said "Answered" as soon as you sent, and a reply relayed from the composer left the card asking again. Plugin authors: a message renderer now also gets `followingRows`, the custom rows after its own. Reload the page.
