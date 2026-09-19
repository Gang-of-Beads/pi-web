---
"@gang-of-beads/pi-web": patch
---

Navigation says it is reading instead of claiming nothing is there.

Tapping a project answered "No sessions here yet." until the read landed, so a
tap that worked read as a tap that did nothing - and the empty claim was not
true. The page now opens on the loading state, names a failed read, and keeps
the empty answer for an actually empty scope. The extension dialog card gained
the identity guard its sibling ask card already had, so neither rebuilds under
the reader while a turn streams.
