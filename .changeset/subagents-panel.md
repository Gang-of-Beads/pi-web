---
"@gang-of-beads/pi-web": patch
---

The browser can see what a session's subagents are doing.

The subagents plugin now owns the whole feature: it reads the runs a session
started on its own machine and lists them in a Subagents panel, with the
working ones counted on the tab. A run that went silent reads as lost rather
than failed, and "not known yet" is never drawn as "none".
