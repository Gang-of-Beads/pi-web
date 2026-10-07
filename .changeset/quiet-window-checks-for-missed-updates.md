---
"@gang-of-beads/pi-web": patch
---

An open session now notices within about 20 seconds when its connection has stopped delivering, instead of looking live. When nothing at all has arrived from the session's server for 15 seconds, the page asks the server for anything it missed, and asks again every 15 seconds for as long as the silence lasts. A working connection sends a small heartbeat more often than that, so it never has to ask. Before, a connection that died without closing went unnoticed for about 44 seconds, and a phone that lost its network said "Trying to sync with the server…" only after about 48 seconds; it now says so after about 24. The 15 seconds is a setting of each browser, under Settings → General → This browser ("Check for missed updates after"), so a phone and a computer can each have their own. Reload the page to pick it up; nothing needs restarting.
