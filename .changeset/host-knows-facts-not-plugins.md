---
"@gang-of-beads/pi-web": patch
---

The shell stops knowing which plugin wants what.

A plugin declares the host facts it needs by name in its package manifest, and
the web process fills them; it no longer asks "is this the updates plugin?" to
attach a docker mode. The navigation accordion the Navigate page replaced is
gone with its hard-coded section order, and the four navigation shortcuts open
the Navigate page on a kind instead of focusing panel sections that no longer
rendered.
