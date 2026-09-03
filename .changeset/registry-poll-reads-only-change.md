---
"@gang-of-beads/pi-web": patch
---

The background-task poll stops re-proving what cannot change: registry files are re-parsed only when their stat changes, and only a running task's process is probed - finished tasks no longer cost a process spawn per poll.
