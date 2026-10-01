---
"@gang-of-beads/pi-web": patch
---

Pinning a session on another machine now works. When the page browsed a remote machine through this one, its pins could not be read (the list showed only what this browser remembered) and pinning or unpinning one of its sessions failed with an error. The pins of every machine now go to that machine, and a pin made there shows here at once. This machine's web server needs a restart, and the remote machine needs this version for its pins to show at once; a remote machine older than the one that first kept pins per machine still cannot have its pins read or changed from here.
