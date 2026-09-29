---
"@gang-of-beads/pi-web": patch
---

A panel whose answer starts arriving but then stalls no longer stays on "Reading…": the 30-second request deadline now covers the whole answer, not just its first bytes, so the read fails honestly and can be tried again.
