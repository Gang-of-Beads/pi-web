---
"@gang-of-beads/pi-web": patch
---

A machine can be reached from this browser instead of through the PI WEB you opened. Add machine asks "Connect from: This browser / This server"; This browser (the default) asks that machine for access, shows a pairing code and a link to the machine's own approval page, and adds the machine once it is approved there. The page then talks to that machine directly - requests, live updates and its plugins - so a machine this device can reach works even when the server cannot reach it. A machine with a token or headers stays on This server.
