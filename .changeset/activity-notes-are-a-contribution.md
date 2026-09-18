---
"@gang-of-beads/pi-web": patch
---

The activity dock stops owning other people's work.

The shell hard-coded what "idle · N background runs" means, which is a domain
it does not own. Plugins contribute activity notes now: the shell keeps the
dock, the idle rule and the session status frame, and whoever owns the work
supplies the count and the words. The bundled background-runs plugin does that
for this chat's own background tasks.
