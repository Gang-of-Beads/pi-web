---
"@gang-of-beads/pi-web": patch
---

A dialog that cannot load says so. Now that settings, the quick switcher and
the session tree arrive as separate modules, a tab that has outlived a deploy
can ask for a module the server no longer has - and the control would simply do
nothing, forever. The failure is reported with the reason and the remedy, and
it is not remembered as an answer, so the next attempt is a real attempt rather
than a replayed rejection.
