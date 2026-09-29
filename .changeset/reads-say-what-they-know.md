---
"@gang-of-beads/pi-web": patch
---

Panels that read from the machine now say what they know:

- **Subagents panel:** an older answer can no longer replace a newer list, and a slow machine no longer gets a pile of repeated reads. A failed refresh keeps the rows already shown and says it could not refresh.
- **Goals section:** it follows the selected session within a workspace. If goals could not be read, it says so and offers a retry instead of disappearing.
- **Links:** a link that names a tool in `view=` opens that tool, even when `tool=` is missing or names another.
- **Status bar:** if the selected session's status could not be read, it now offers Retry.
- **Supervisor requests:** a request you already answered shows your answer instead of asking again. Each reply names the request it answers, so two questions from one subagent no longer share an answer.
- **Stalled reads:** a plugin read whose body stalls now ends at the request deadline.
