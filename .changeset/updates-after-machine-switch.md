---
"@gang-of-beads/pi-web": patch
---

Updates stays in Go to after switching machines. Switching cleared the machine's PI WEB status without asking for the new one, so Updates disappeared until the next check about 15 minutes later; a failed status read is now asked again after 15 seconds instead of 15 minutes.
