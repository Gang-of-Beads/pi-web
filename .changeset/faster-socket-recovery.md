---
"@gang-of-beads/pi-web": patch
---

A phone that regains signal reconnects in seconds instead of a minute. A
connection the network kills without a FIN stays OPEN and silent in the
browser, and the only thing that retired it was a 50s silence budget sampled
every 15s — up to 65s of stale screen after the network was already back. The
budget is now two daemon keepalives plus a margin (42s), sampled every 5s, the
handshake budget drops from 15s to 10s, and a tap probes the sockets
immediately: somebody touching the screen is somebody waiting.
