---
"@vincenthanxiaodu/pi-web": patch
---

Show the workspace's goals on a phone

Goals lived in the navigation panel, which a phone never shows, so a running
goal was invisible on the device most likely to be asking what the session is
working towards. They now appear as a tab in the drawer above the transcript,
beside activity and notifications, with the same Resume, Pause and Abandon
controls.

The tab is offered only when the workspace has a goal, and never takes the
drawer from work in flight. The drawer itself used to render only when there
was activity or a notification, which hid goals in exactly the case where
nothing else was running.
