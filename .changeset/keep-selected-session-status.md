---
"pi-web": patch
---

A reconnect no longer erases the selected session's status when the status catalog transiently omits it — the indicator row (streaming dot, token stats) stays until a live frame corrects it. The queued-message area also reconciles against the daemon's queue state.
