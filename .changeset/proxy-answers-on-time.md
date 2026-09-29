---
"@gang-of-beads/pi-web": patch
---

A session request the session daemon does not answer now ends after 25 seconds with a clear "did not answer" error instead of hanging until the browser gives up, and closing the page cancels the request on the daemon side.
