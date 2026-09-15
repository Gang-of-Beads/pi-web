---
"@gang-of-beads/pi-web": patch
---

Daemon plugins can read session transcripts through a host port.

`ServerPluginHostPorts.sessionTranscripts` lets a plugin running in the
session daemon list a workspace's sessions and page one session's
transcript, in the same bounded browser projection the transcript UI gets.
There is no write path, so the daemon stays the only producer of session
files; the port refuses reads with a named error while the session service
is still starting rather than answering an empty list. Web-process plugins
see no port. This is the seam full-text search and export plugins build on.
