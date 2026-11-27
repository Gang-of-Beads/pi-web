---
"@gang-of-beads/pi-web": patch
---

A plugin page reads and asks a session's extensions on another machine too. The extension bus routes were missing from the list a machine forwards, so on a remote machine a page saw nothing published and its requests failed.
