---
"@gang-of-beads/pi-web": patch
---

Browser plugins can tell which device asked for a run: `onDidEndRun` now says `askedBy`, `this-device` or `another-device` for the session on screen, and `unknown` otherwise, so a notification can ring only on the device that sent the message. To do this, the machine records the sending browser's device id (a random id per browser profile) on each message it receives from a browser.
