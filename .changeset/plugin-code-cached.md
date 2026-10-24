---
"@gang-of-beads/pi-web": patch
---

Reopening PI WEB no longer downloads each plugin's module again before the session appears: the browser keeps a plugin's module for its content revision and fetches it again only when the plugin changes. Another machine's plugins are kept once that machine runs this version. On a slow phone link (1.6 Mbps) a relaunch now shows the session in about a second instead of five. Restart the web service and reload open pages.
