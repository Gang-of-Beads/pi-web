---
"@gang-of-beads/pi-web": patch
---

Extension shortcuts, extension autocomplete, Esc for extensions and **Continue from** now work on a remote machine too. The gateway did not forward their requests to the remote machine, so each answered 404 there, and Continue from wrongly said the remote machine needed an update. Restart the web service on the machine you open PI WEB from.
