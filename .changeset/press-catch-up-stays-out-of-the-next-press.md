---
"@vincenthanxiaodu/pi-web": patch
---

A catch-up scroll scheduled by one touch press no longer fires into the next one. The timer could land up to 250ms into a new press, scrolling the transcript between the press and its click, so the tap registered on whatever moved into its place - the "first tap does nothing, second works" pattern on dialog cards. Starting a new press now cancels the previous press's pending catch-up, symmetric with how it already dropped a deferred card alignment.
