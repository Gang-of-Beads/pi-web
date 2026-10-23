---
"@gang-of-beads/pi-web": patch
---

With machines that do not answer, the Machines list no longer marks working machines Offline when the page is reached over plain http: what the page reads on its own about a machine you are not browsing gives up after 8 seconds, and a check that got no answer is checked once more before it reads Offline. The machine you are browsing keeps its longer limits, so if that machine is one that does not answer, the page can still wait on it.
