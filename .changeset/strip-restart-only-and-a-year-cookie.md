---
"@gang-of-beads/pi-web": patch
---

The version strip asks for one thing, not two: a stale process gets Restart (Reload stays for the page-is-older case), and a restart loads the page again by itself once the process reports itself current. The access cookie now lasts a year and still renews daily while in use, so a browser signs in once.
