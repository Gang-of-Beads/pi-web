---
"@gang-of-beads/pi-web": patch
---

A multi-step extension menu, such as pi-multi-account's `/accounts`, no longer loses its next step. Answering one dialog could hide the dialog the extension opened right after it until the page was reloaded, most often over a slow connection.
