---
"@gang-of-beads/pi-web": patch
---

On Linux, the session daemon no longer freezes or grows to gigabytes of memory when a large folder such as `node_modules` is deleted or installed inside an open session's folder. It now watches only the folders whose changes the file and git panels show, instead of every file, so it stays responsive and light. Those panels still refresh on their own when files or git state change.
