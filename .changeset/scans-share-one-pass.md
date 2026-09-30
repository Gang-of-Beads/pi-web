---
"@gang-of-beads/pi-web": patch
---

The session daemon now does the work of listing sessions once when several lists are asked for at the same moment. It used to read every session file again for each of them. That made a machine that had just started slow to answer every list, and busy for everything else. The session daemon needs a restart for this to take effect.
