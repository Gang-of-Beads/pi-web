---
"@gang-of-beads/pi-web": patch
---

The background-task poll no longer reads whole transcripts. It used to read the entire session file - hundreds of megabytes for a long-lived session - on every poll, which starved the event loop and made everything feel stuck. A transcript only grows, so the scan now keeps a watermark and reads just the growth.
