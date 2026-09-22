---
"@gang-of-beads/pi-web": patch
---

The status bar says which kind of nothing it has.

"No session status yet" covered both a read that has not happened and one
that failed, and the failed one sat there with no way to ask again. A failed
read says so and carries Retry.
