---
"@gang-of-beads/pi-web": patch
---

Reload on the version strip now goes past the cache: it navigates to the page with a fresh query string instead of `location.reload()`, which an installed PI WEB answered with the same cached shell, so the strip came back and offered the reload again.
