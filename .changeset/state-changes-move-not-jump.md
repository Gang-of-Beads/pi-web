---
"@vincenthanxiaodu/pi-web": patch
---

Let the activity surfaces change state visibly rather than instantly. A row going from running to done, the status dock moving between idle, working and asking, and the drawer's tabs and filters changing selection all switched colour between one frame and the next, which reads as a flicker rather than as something happening. They now ease over the project's own motion tokens — colour only, so nothing moves position — and collapse to no transition at all under `prefers-reduced-motion: reduce`.
