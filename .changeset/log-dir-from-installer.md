---
"@gang-of-beads/pi-web": patch
---

Log trimming now works when `PI_WEB_DATA_DIR` is set only in your shell profile. `pi-web install` records where the service writes its logs, and PI WEB trims those files. Run `pi-web install` again so the existing services pick this up.
