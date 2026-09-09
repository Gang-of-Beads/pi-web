---
"@gang-of-beads/pi-web": patch
---

One word for the state between answered and refused. A request that goes
unanswered is `unverifiable` everywhere now — it was `unanswered` in the message
lifecycle, "did not answer within 30s" in a page-level banner, and `failed` on
the delivery row, three names for the state a flaky link produces most often. A
message whose answer was lost says "No answer yet" on its own row and stays open
for a later answer to close, instead of claiming it was never sent; the page
banner speaks only for the link and stays quiet while the socket is proven live;
and an ambiguous settlement now carries whether the bytes ever left this
process, which is the fact that decides whether resending is safe.
