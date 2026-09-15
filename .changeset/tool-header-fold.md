---
"@gang-of-beads/pi-web": patch
---

Tool pages fold their controls under one host header.

Every workspace tool page now opens with a single header - the tool name,
its summary (the git branch), and a fold that holds the tool's controls,
remembered per tool and collapsed by default - instead of stacking a bar
of its own under the app's. The git panel moves its mode, view, refresh
and worktree controls behind that fold, and the phone title names the tool
page on screen instead of "Sessions".
