---
"gang-of-beads/pi-web": patch
---

The session drawer's built-in Activity and Notifications pages are removed
rather than converted. The drawer now renders exactly what plugins contribute:
with no contributed section it disappears entirely, and a background activity
dock is a silent pill instead of a drawer control. The notifications data layer
(socket inbox frames, inbox controller and state) went with the page; session
notifications are still filed server-side - warnings, dialog outcomes, command
receipts and runtime notices - and stay invisible until a plugin page returns
for them. Subagent run and background-task conversation viewers retired with the
activity panel; the dock pill still names live background work.
