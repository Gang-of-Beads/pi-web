---
"@gang-of-beads/pi-web": patch
---

Opening a session now shows its conversation without waiting for the agent behind it to load. PI WEB reads the latest messages straight from the session file and loads the agent's status at the same time. On a large session that was not already open, the first messages used to appear only after the status, at about 3 seconds; they now appear at about 2 seconds, before the status. If the status can't be read, the conversation stays on screen and only the status reports the failure. A session that was rewound with the session tree no longer shows its discarded replies to plugins that read transcripts. The session daemon needs a restart for this to take effect.
