---
"@gang-of-beads/pi-web": patch
---

Opening a session from another project now updates the address bar to that session's project. Before, the page switched to the right project, but the address kept naming the project you had come from, so a reload or Back briefly showed the wrong one. Going back to an address that names only a deleted session now says it is gone, instead of leaving the previous session on screen. Reload the page to pick this up.
