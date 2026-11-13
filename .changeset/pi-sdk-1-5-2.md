---
"@gang-of-beads/pi-web": patch
---

Require Pi Coding Agent 1.5.2 or newer, including large-file tool, session lifecycle, OAuth and provider fixes. The session daemon waits for pending credential writes before orderly exit so refreshed tokens are not lost.

Follow Pi's new idle cache-warming default: eligible caches may be refreshed for up to 30 minutes between runs; explicit global Pi settings still take precedence. Warming costs are retained without making untouched sessions recent in the list or invalidating an open session-tree action when only warming records changed, and /tree opens on the most recent real entry, when there is one, rather than a warming record. Keep each queued message's sender on Pi 1.5.2, including photos sent together without captions and messages that image resizing or an extension rewrites; a message whose sender cannot be proven stays unlabeled instead of taking another message's. Taking back one queued message keeps the others in their order; while the agent works they are handed to it to read at its next step, like any message sent while it works.

Increase the repository's Compose stop allowance and deployment examples to the drain time plus 20 seconds (80 seconds with the default drain), leaving time to save refreshed credentials. Existing containers need an explicit update/recreation to adopt the new allowance.

After installing the update, restart the session daemon and the web service in an idle window, and reload open pages.
