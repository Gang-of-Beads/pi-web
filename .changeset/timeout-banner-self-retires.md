---
"pi-web": patch
---

A request deadline is now an honest, self-withdrawing notice. When a request
crosses its 30s deadline, the banner said "The server did not answer within
30s." and then stayed forever - a plain Error landed on the reader lifetime,
and the self-healing word list had no rule for it. Measured live: a remote
machine answered /status at 30.007s against the browser's 30.000s deadline,
and the banner outlived a session that went on replying. A timeout notice
now retires on the next successful exchange and expires like the other
self-healing complaints.
