---
"@gang-of-beads/pi-web": patch
---

The remaining bundled tools fold under the host header.

Files, Relays, Updates and Info each stacked a titled bar of their own
under the tool header - the exact stacking the git fold retired. Files'
Upload and Refresh move into the fold (stale rides the summary); Relays'
toolbar becomes a plain picker row with Refresh in the fold and the open
relay named beside the title; Updates shows its message count as the
summary with no bar; Info simply loses its bar. The files stale flag is
shared module state so the host header can read it, and the panel asks
the host to re-render when it flips.
