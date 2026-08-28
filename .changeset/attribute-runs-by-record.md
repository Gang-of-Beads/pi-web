---
"@vincenthanxiaodu/pi-web": patch
---

Show a subagent run only in the session that started it. A run with no directory of its own was attributed to whichever session happened to be listing while its transcript was being written, so any session's live child appeared in every session at once - two sessions showing a running ring, and a session with no children of its own reporting a background run. Membership now comes from what is written on disk: the run's directory under its parent, or the spawn the parent recorded in its own transcript. Measured on a real project, three runs were previously claimed by all eight sessions and none is now claimed by more than one.
