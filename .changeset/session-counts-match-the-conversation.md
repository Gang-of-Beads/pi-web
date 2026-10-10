---
"@gang-of-beads/pi-web": patch
---

The session list, Go to and archived sessions now count a session's messages the way its conversation does, so the number no longer changes when you open a session. A closed session used to count every message line in its file, including replies on branches you left and failed attempts pi retried, and it left out the compactions and extension messages the conversation shows. On a large session store the first session listing after the session daemon starts takes a little longer (about 1.5 s more for 7 GB of sessions). Restart the session daemon to pick this up.
