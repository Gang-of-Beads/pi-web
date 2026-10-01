---
"@gang-of-beads/pi-web": patch
---

A remote machine's Goals page, terminal, subagents card and project and machine lists load again. Each plugin is loaded once more for every remote machine, and the second copy failed because its page elements were already defined. A browser reload is enough.
