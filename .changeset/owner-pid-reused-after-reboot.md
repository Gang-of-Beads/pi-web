---
"@gang-of-beads/pi-web": patch
---

On macOS and Windows, the session daemon starts again after a reboot that gave its old process id to another program (#73). Before, it took that program for the previous daemon and refused to start until its ownership marker was removed by hand, so every session page answered with errors. It now watches the marker's heartbeat and takes over once the heartbeat has not changed for 30 seconds.
