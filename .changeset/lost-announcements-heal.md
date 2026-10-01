---
"@gang-of-beads/pi-web": patch
---

When the live connection drops a single update without closing (a pin, a rename, an unread mark, a session's status), the page now notices within about 20 seconds and reads that machine's state again, instead of showing it out of date until the page is reloaded. Restart the session daemon and reload the page to pick this up.
