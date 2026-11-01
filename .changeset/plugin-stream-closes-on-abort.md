---
"@gang-of-beads/pi-web": patch
---

Stopping a streamed file preview (a video or audio clip, or a download) before it starts playing no longer crashes the web process on Node.js 25 and marks the local machine offline; the file is closed as soon as the browser leaves instead of on garbage collection.
