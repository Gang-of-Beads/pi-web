---
"@gang-of-beads/pi-web": patch
---

Plugin routes answer with a file through `reply.sendFile(handle)`: PI WEB sets `Last-Modified`, answers byte ranges (whole files when `If-Range` names another version), sends exactly the file's length, and closes the file when the answer ends or the browser leaves. `reply.send` takes a string, bytes, or a Node stream; other async iterables are no longer accepted.
