---
"@gang-of-beads/pi-web": patch
---

An extension's notifications now look like they do in pi's terminal. An info message is one dim line at the end of the conversation, and the next info message replaces it instead of stacking another card; a long one shows three lines and opens fully when tapped. Warnings and errors are appended as one line each, prefixed "Warning:" or "Error:", and the same one again within ten seconds counts up ("×2") on its line. They are not saved: a reload does not bring them back. Restart the session daemon and reload the page to pick this up.
