---
"@gang-of-beads/pi-web": patch
---

A session no longer shows "idle" next to a conversation that is missing the reply. The page checks quietly whenever it may have missed something (it came back from the background, its connection dropped or came back, the network came back, a turn just ended) and fetches only what it missed. When the page sent something and the server has not answered for a few seconds, the top row says "Trying to sync with the server…" (or names the remote machine it is trying to reach) instead of "Reconnecting…", and it keeps trying; nothing says "offline" outside the Machines page. A dropped last batch of messages is now noticed and fetched too. Reload the browser.
