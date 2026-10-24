---
"@gang-of-beads/pi-web": patch
---

Scrolling up through a long session no longer stalls on pages with images you sent: those images load when they come into view, as tool-result images do, and earlier messages start loading three screens before the top, the next page as soon as one arrives. Edit and send again and the composer's history still bring the images back, fetched when you use them: Edit and send again brings the words back at once and the images join when they arrive. Opening an archived session to look at its images no longer starts it. This changes the session daemon: restart the session daemon and the web service, and reload open pages.
