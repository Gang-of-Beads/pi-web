---
"@vincenthanxiaodu/pi-web": patch
---

Operate a goal from the goals panel

The panel listed goals and their progress but offered no way to act on them, so
resuming or pausing meant typing a slash command into the composer. Each open
goal now carries Resume or Pause and Abandon controls that run the extension's
own commands in the focused session, keeping its audit trail, token accounting
and goal-focus rules intact. Controls are disabled, with the reason, when no
session is open to run them in.
