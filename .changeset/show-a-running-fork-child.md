---
"@vincenthanxiaodu/pi-web": patch
---

Show a subagent that is working but has no run directory.

A child running in a fork of the parent context may never get a run directory:
its transcript goes to the shared `forks/` folder, and the only trace under its
own id is what it writes into the project's artifacts directory. Enumeration
walked directories only, so such a run was missing from the activity list for
its whole life and after it - measured on a live child, the directory was absent
for the 90 seconds it ran and stayed absent once it had finished.

Runs are now found from a live transcript artifact as well as from a directory.
A run writes its prompt and opens its transcript when it starts and only writes
`meta.json` when it ends, so those two facts are kept apart: a run with a
transcript and no report is shown as running rather than done, and its agent
name is read from the artifact instead of falling back to the generic label.

Nothing in an artifact names the session that started the run, and the artifacts
directory is shared by the whole project - measured on one project, two sessions
with overlapping lifetimes shared 35 artifacts of which 19 belonged to the other
session. A run without a directory is therefore only claimed while its transcript
is still being written and the parent is streaming, so a neighbouring session's
history is never adopted.
