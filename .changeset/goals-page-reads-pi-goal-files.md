---
"@gang-of-beads/pi-web": patch
---

The Goals page now lists the goals pi-goal writes. It read each goal file as plain JSON, but pi-goal writes a readable copy of the goal after the JSON, so every goal was skipped and the page said "No goals in this workspace" while goals were open. Restart the session daemon to pick it up.
