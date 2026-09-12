---
"@gang-of-beads/pi-web": patch
---

A dead workspace says so before offering a new session, and says it once.

The workspace listing now stamps cwdMissing the way the session listing
does: a workspace whose folder is gone renders its row inert with a
"folder gone" badge, and "+ New session" inside it fails fast with one
sentence instead of creating a phantom "New session" that sits selected
on an empty chat while the daemon's folder error repeats in two
different places.
