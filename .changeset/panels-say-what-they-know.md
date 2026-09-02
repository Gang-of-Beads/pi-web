---
"@gang-of-beads/pi-web": patch
---

Panels and sessions say what they actually know

A transcript could sit on "Loading this session…" for good. Clearing that
notice was restricted to the read that set it, which is right, but two ways of
leaving a session advance past a read without starting another one, so nobody
was left to clear it.

The Goals drawer asked for room whether or not the plugin behind it was
installed: an uninstalled plugin and an installed one with nothing in it drew
the same empty panel. The runtime is now asked directly. A plugin that failed
to load still shows its panel, so a broken install is visible rather than
tidied away, and a runtime that cannot answer keeps the panel too - not knowing
is not the same as knowing there is nothing there.

A session too young to be written to disk no longer reports "Session not
found", which is accurate about the machine and misleading to you: the same
words describe a deleted session. Nor does it invite a first message into a
session that is not there yet. It says it is still syncing.
