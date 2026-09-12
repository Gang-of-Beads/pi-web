---
"@gang-of-beads/pi-web": patch
---

Cleanup can archive every session whose folder is gone.

The cleanup dialog gains "Archive sessions whose folder no longer
exists": a checkbox beside the idle-day threshold, independent of it.
The daemon's planner probes each non-archived session's folder and
archives the missing ones (busy sessions still skipped), so the
dead-folder rows that can never open leave the live list in one
deliberate sweep instead of one row-menu archive at a time.
