---
"@gang-of-beads/pi-web": patch
---

PI WEB no longer has an `ask_user` tool of its own: a question tool comes from a pi extension you install, such as pi-ask-user, and its questions show as extension dialog cards. The `askUser` setting and `PI_WEB_ASK_USER` are retired; a config file that still sets `askUser` loads, and the key has no effect. Settings no longer has a Session daemon section, since its only setting was that switch. An old conversation shows a past `ask_user` call as an ordinary tool row and its answers as an ordinary message. Restart the session daemon to pick this up.
