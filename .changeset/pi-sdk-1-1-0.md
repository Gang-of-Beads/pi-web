---
"@gang-of-beads/pi-web": patch
---

Upgrade the Pi runtime and SDK dependencies to v1.1.0 and require v1.1.0 or later Pi peer dependencies. Sessions now run on pi 1.1.0, which among its fixes retries `server_busy` provider errors and counts the cost of long prompts correctly. Restart the session daemon and the web service, and reload open pages.
