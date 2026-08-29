---
"@vincenthanxiaodu/pi-web": patch
---

A slash command forwarded to the agent whose turn then shows nothing no longer vanishes. Measured live: /goal-resume with no goal appended only empty assistant messages, so the command looked like it never ran. The turn's end now says "/goal-resume finished without any output." in the transcript, and the record persists in the notification drawer across reloads.
