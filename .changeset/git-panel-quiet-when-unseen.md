---
"@gang-of-beads/pi-web": patch
---

The Git panel no longer reads the repository's status while you cannot see it. It read every 8 seconds for as long as it was open, including while the phone showed the chat or the tab was in the background. It now reads only while the panel is on screen, and reads at once when you come back to it. A change made while the panel was already reading now shows as well, instead of waiting for the next read. Reload the page to pick this up.
