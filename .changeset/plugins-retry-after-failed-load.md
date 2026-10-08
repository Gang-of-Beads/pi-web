---
"@gang-of-beads/pi-web": patch
---

A plugin whose browser script failed to load (a phone whose connection dropped while the page opened) is tried again: after a short pause, and at once when the page comes back online or into view. Until then, a message that plugin draws says "Not drawn yet" and that a plugin did not load in this tab, instead of "Unrecognized message: Nothing on this machine renders it". Before, every such message stayed "Unrecognized" until the page was reloaded. Restart the web service.
