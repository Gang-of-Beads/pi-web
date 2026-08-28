---
"@vincenthanxiaodu/pi-web": patch
---

Show a subagent run that has started but not written anything yet.

A child agent that runs in a fork of the parent context writes its transcript to
a shared `forks/` directory and leaves its own run directory empty until it
finishes. The activity list treated an empty directory as "not a run" and
dropped it, so those children were missing from the list for exactly as long as
they were working, and appeared only once they were over. Measured on a live
session: two children were working while the drawer said "Nothing running right
now", and the endpoint reported 12 runs where there were 16.

An empty run directory is now reported, and the existing rule decides what it
means — running while the parent is streaming, unknown when it is not. The
neighbouring `forks` directory is still excluded: a run directory is named after
the child session, and that name is what tells the two apart.
