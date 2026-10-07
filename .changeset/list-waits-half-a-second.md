---
"@gang-of-beads/pi-web": patch
---

The session list now waits up to half a second for the machine's answer when the page opens. If it arrives in time, the current list is drawn straight away, with no remembered list replaced in front of you. If it takes longer, the list this browser remembered is drawn with "Syncing…" in the top row, and the answer slides in when it lands. When a project or workspace does not answer, its remembered sessions stay in the list until it does. Reload the page to pick it up.
