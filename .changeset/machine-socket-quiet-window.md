---
"@gang-of-beads/pi-web": patch
---

A machine connection that stops delivering without closing is now noticed within the same quiet window as a session's (15 seconds by default, the "Check for missed updates after" setting): the page then reads again what that connection keeps live (pins, unread marks, session states and names), instead of waiting up to 42 seconds. A remote machine still on an older PI WEB keeps the old behavior. Restart the session daemon and the web service to pick it up.
