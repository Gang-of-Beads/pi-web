---
"@gang-of-beads/pi-web": patch
---

A remote machine's Goals page, terminal, subagents card and project lists load again. A remote machine brings its own copy of these plugins, and that copy failed to load because the gateway's copy had already defined its page elements. A browser reload is enough.
