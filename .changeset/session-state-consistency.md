---
"@vincenthanxiaodu/pi-web": patch
---

Lost push frames now repair themselves instead of surfacing as stale state. Every session frame is stamped with a monotonic sequence; the daemon keeps a bounded replay ring, and when the browser sees a gap it holds the live tail, replays exactly the missed range in front of it, and only falls back to a full refresh when the ring cannot serve. A frame that fails validation counts as a gap rather than vanishing. Ask and dialog cards carry the surface revision end to end (previously stamped but stripped by the client's own validators, which disarmed the stuck-card repair), a restarted daemon's fresh counters are detected through the instance identity instead of deafening the surface, and the notification count is pinned to the list it counts. Each remaining client timer names the surface it backs up.
