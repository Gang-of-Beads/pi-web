---
"@vincenthanxiaodu/pi-web": patch
---

The turn clock counts from the turn's own start rather than from when a tab first looked at it. The session status now carries `turnStartedAt` — the transcript's last input boundary, published while the session is working — and the transcript clocks from it. A tab that joins mid-turn, reloads, or reconnects shows the elapsed time the turn has actually been running instead of restarting the count, which is what made a long turn indistinguishable from a stuck one. A daemon that does not publish the field degrades to the previous first-sighting anchor.
