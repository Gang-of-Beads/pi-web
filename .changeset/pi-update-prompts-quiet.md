---
"@gang-of-beads/pi-web": patch
---

Pi extensions that offer to update pi (such as pi-updater) no longer prompt inside PI WEB sessions: their "Update now" could not work there, and they compared against the pi bundled with PI WEB rather than the one you run. A pi started in a PI WEB terminal still checks for updates as usual, and a `PI_SKIP_VERSION_CHECK` you set yourself is kept. Restart the session daemon to pick this up.
