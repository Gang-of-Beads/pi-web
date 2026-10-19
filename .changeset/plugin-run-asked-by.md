---
"@gang-of-beads/pi-web": patch
---

Browser plugins can tell which device asked for a run: `onDidEndRun` now says `askedBy`, `this-device` or `another-device` from the newest user message the run took, for a run of the session on screen whose start the page saw, and `unknown` otherwise (including a run an extension started), so a notification can ring only on the device that sent the message. To do this, the machine records the sending browser's device id (a random id per browser profile) on each message it receives from a browser.
