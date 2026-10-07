---
"@gang-of-beads/pi-web": patch
---

When an extension asks something PI WEB cannot show (a kind of question a newer pi added before PI WEB knows it), the row saying so now stays in the conversation: it is still there after a reload and on your other devices. pi's own terminal does not show it and the model does not read it. Restart the session daemon to pick it up.
