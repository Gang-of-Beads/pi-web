---
"@gang-of-beads/pi-web": patch
---

Browser plugins now receive their own `plugins.<id>.settings`. The page never handed them over, so the voice plugin's microphone stayed hidden even where dictation was configured. A running plugin also hears when its settings change.
