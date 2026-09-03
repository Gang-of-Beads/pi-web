---
"@gang-of-beads/pi-web": patch
---

The daemon owns its prompt queue, durably. A follow-up accepted while the agent is busy parks in the daemon's own on-disk queue with its sender's id, drains one at a time when the runtime settles, and survives a daemon restart - the restart that used to erase queued messages without a word now reloads and delivers them. Recall acts on identity, steers still join the running turn immediately.
