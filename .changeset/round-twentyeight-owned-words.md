---
"@gang-of-beads/pi-web": patch
---

Scope switches keep reader-retired failures visible, and machine banners
carry the machine's name.

Leaving a workspace or machine no longer silently eats the banner recording
a failure the reader acted on - the claim survives the switch and is still
there on return, which is the notification. Gateway health and runtime
failures now compose the machine's name - "lab-mac is unavailable;
reconnecting… connect ECONNREFUSED…" - the same wording the deep-link path
already writes, instead of an anonymous "Reconnecting to the machine…" that
erased the one fact the reader could not see anywhere else.
