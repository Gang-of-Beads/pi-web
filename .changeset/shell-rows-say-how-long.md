---
"@gang-of-beads/pi-web": patch
---

A finished bash or PowerShell command now ends with how long it took ("Took 1.3s"), as pi shows it, and the time stays after a reload. It comes from the duration pi 1.1.0 records, so commands run before the upgrade show none. Extension tool renderers also receive pi 1.1.0's `durationMs` and `outputPad`, as they do in pi. Restart the session daemon and reload open pages.
