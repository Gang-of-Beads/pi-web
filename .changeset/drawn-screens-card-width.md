---
"@gang-of-beads/pi-web": patch
---

A screen an extension draws for pi's terminal is now drawn at the width of its card, as pi's terminal draws at the terminal's width, so the extension cuts its own long lines instead of their ends wrapping onto the next line on a phone. With the same screen open on two devices, it follows the one last opened, resized or used. Restart the session daemon to apply.
