---
"@gang-of-beads/pi-web": patch
---

The composer's text is now kept with the session on its machine, so a draft started on one device continues on another: what you type shows on every device that has the session open, a reload keeps it, and sending it clears it everywhere. When two devices type at once, the later edit wins; a device that is typing when another sends keeps its own text. Attached files still stay in the browser they were added in. Restart the session daemon and the web service, and reload the page.
