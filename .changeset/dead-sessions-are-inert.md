---
"@gang-of-beads/pi-web": patch
---

A session whose folder is gone is no longer offered as if it could open.

The preferred-session choice (restore, deep link, latest-memory) could
still land on a dead session, which selected a row that can never load
and raised the same "folder no longer exists" notice on every boot - the
fourth occurrence. The preference now skips dead sessions on every
branch and falls through to the next live one, and a dead row renders as
a resting fact - a plain row with its "folder gone" badge - instead of a
button whose click does nothing.
