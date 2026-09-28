---
"@gang-of-beads/pi-web": patch
---

A subagent's supervisor card shows what the child asked. The card never read the question field pi-subagents writes (`requestBody`), and it knew none of the reasons pi-subagents actually sends except progress updates, so a decision request rendered as a bare "Message from delegate" with only a run id and a reply box. It now reads "Decision request from delegate" (or "Interview request", "Progress update") with the question underneath.
