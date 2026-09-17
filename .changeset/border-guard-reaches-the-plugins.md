---
"@gang-of-beads/pi-web": patch
---

The bordered-control guard reaches plugin components, and the upload dialog's
close key gets its box.

The guard only read `src/client/src/components`, so plugin chrome could keep
drawing bare glyphs; extending it immediately found the files plugin's upload
dialog closing with an unboxed character. The guard now also accepts a border
inherited from a file's shared `button` rule, so it names real offenders rather
than every component that styles its controls once.
