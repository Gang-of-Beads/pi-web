---
"@gang-of-beads/pi-web": patch
---

A transcript reopened later starts from what it already had.

The cached page lived in sessionStorage, which a phone empties whenever the
browser reclaims the tab, and expired after half an hour: coming back to a
conversation therefore rebuilt it from the daemon every time. The cache is
durable now, and a hit is replayed forward from its watermark rather than
refetched.
