---
"@vincenthanxiaodu/pi-web": patch
---

Accept the home-directory shorthand everywhere a working directory is compared. A session created or recorded with `~/code` used to be invisible to a client asking for `/Users/<name>/code`: the request boundary rejected the tilde outright, stored headers kept it verbatim, and the equality check resolved the two forms differently. The request and stored-path boundaries now expand a leading `~` to the daemon user's home directory, so the shorthand and the absolute form address the same sessions.
