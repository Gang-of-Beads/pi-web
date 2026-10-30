---
"@gang-of-beads/pi-web": patch
---

On Windows, the session daemon now waits a moment when another program, such as a virus scanner or a second daemon checking ownership, has its ownership marker open. Before, it missed that heartbeat, could fail to start while taking over a stale marker, and could leave its marker behind when it stopped.
