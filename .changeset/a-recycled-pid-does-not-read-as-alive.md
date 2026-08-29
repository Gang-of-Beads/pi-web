---
"@vincenthanxiaodu/pi-web": patch
---

A background task whose process was killed from outside the tracker no longer reports running forever. Measured live: a web-server task that died on August 24 still counted itself running on August 29 - five days - because the operating system had handed its pid to /usr/libexec/microstackshot. The pid's start time is its identity: a process born long after the task began is a stranger wearing the number, and the record reads lost.
