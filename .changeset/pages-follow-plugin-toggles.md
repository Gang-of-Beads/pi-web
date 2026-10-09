---
"@gang-of-beads/pi-web": patch
---

Turning a PI WEB plugin on or off now changes every open page at once, on this device and every other one browsing that machine: the plugin's panels, pages and other pieces appear or disappear without a reload, and closing Settings no longer reloads the page. A machine running an older PI WEB still reloads the page when Settings closes. Restart the web service and the session daemon, then reload open pages once, to pick this up.
