---
"@gang-of-beads/pi-web": patch
---

The web and session daemon logs no longer write two lines for every request. By default they record failed and slow requests only, and a log file larger than 50 MB is trimmed, keeping three older copies (`web.log.1` and so on). Settings → General → Logs changes what is recorded (failures and slow requests, every request, or debug) and the size and number of copies, per machine, within a minute and without a restart. Restart the PI WEB web service and session daemon to pick this up.
