---
"@gang-of-beads/pi-web": patch
---

A working session no longer sends its whole status to every open page when nothing in it changed. It used to send one every two seconds during a long tool call, and one for every piece of a tool call the model was still writing and every line a running command printed: a single small bash call sent 218 statuses, 207 of them the same as the one before (about 390 KB), on the session's connection and again on every machine connection; it now sends 15 (25 KB). Now a status goes out only when something in it changed. Restart the session daemon to pick it up.
