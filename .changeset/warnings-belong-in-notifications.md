---
"@vincenthanxiaodu/pi-web": patch
---

Warnings now file in the session's notification drawer instead of stacking as cards above the transcript. Each warning occurrence becomes exactly one drawer record; dismissing the record of a warning with a server-side off-switch (the Anthropic billing notice) also silences the warning itself. The transcript-top cards, their collapse control and the status-bar warning counter are removed, so warnings can no longer fill the screen or move the layout. Slash and goal-panel commands now leave an immediate receipt row in the transcript (queued → running → ok/failed), and goal panel buttons disable the moment one is pressed.
