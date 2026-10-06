---
"@gang-of-beads/pi-web": patch
---

A session no longer shows "idle" next to a conversation that is missing the reply. The page now checks quietly whenever it may have missed something (it came back from the background, its connection dropped or came back, the network came back, a turn just ended) and fetches only what it missed. The status reads "Syncing…" only when the page knows messages are missing or a check could not get through, and it keeps trying until it does; it never says "offline". A dropped last batch of messages is now noticed and fetched too. Reload the browser.
