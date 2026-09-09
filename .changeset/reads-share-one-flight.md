---
"@gang-of-beads/pi-web": patch
---

Reads for the same path share one round trip while it is unsettled. Several
surfaces ask for the same thing at the same moment — a session switch, the
panel behind it, a reconnect — and each ask was its own request, which costs
latency on exactly the interaction being watched. Writes are never shared: two
sends that look identical are two messages, and what makes a repeat safe lives
in the daemon's operation ledger, not in a client-side map. A caller that
brought its own abort signal keeps its own request, so one caller's cancellation
cannot settle another's read, and a shared entry is dropped the moment it
settles — it is a shared flight, not a cache.
