---
"@gang-of-beads/pi-web": patch
---

Accept audio and video file previews from the server. The plugin API already declares these media types and the server already returns them, but the browser refused the response with "Invalid file media type", so a plugin could not preview audio or video files.
