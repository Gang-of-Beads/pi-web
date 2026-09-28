---
"@vincenthanxiao/pi-web": patch
---

The transcript stops fetching and moving on its own.

Four review lanes traced every writer of `chat.scrollTop` and every producer that can
start a load. The transcript loaded history while the reader was pinned at the newest
end (nothing above them had changed), the forward end fetched from a render rather than
a scroll - which slides the window page by page under a stationary reader - and a
restore that could not find its saved row slammed the view to the top of the loaded
window, which reads as the middle of the session.

Now: history answers an upward scroll and nothing else, the forward end answers a
downward one, an unfilled viewport is the only exception, and a restore that missed
fetches the page its row lives in and stays put. The jump-to-newest control fetches the
pages between here and there back to back, so it lands on the newest instead of on the
boundary of the loaded window.

The policy itself is one pure classifier (`chatViewport/viewportDecision.ts`) over
(stored open, scroll, growth, jump, page arrival) with an exhaustive cross-product test,
so the states the owner described - bottom opens at the newest page, a stored spot opens
at that spot, one page each - are named rather than spelled out at four call sites.
