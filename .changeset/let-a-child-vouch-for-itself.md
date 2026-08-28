---
"@vincenthanxiaodu/pi-web": patch
---

Let a running subagent vouch for itself.

A child that runs in a fork of the parent context never creates its own run
directory, so it is listed only through the transcript it writes in the shared
artifacts directory. That path admitted such a run only while the parent session
was streaming — and the reader watches precisely when the parent is idle, having
asked for something and waiting. So every running fork child disappeared at the
moment someone looked for it, and the drawer answered "Nothing running right
now" while children were working.

The precedence was backwards. A transcript appended to seconds ago proves the
child is alive whatever the parent is doing; the parent's activity is a fallback
for a child that has produced no evidence of its own, which is what the code
already said about a run that has written nothing at all. Measured on the live
session directory: with the parent idle the list reported no running work, and
now reports the child whose transcript had been touched moments earlier, while
ten husks left by children that died before writing stay `unknown` and
transcripts silent for twelve hours are still left alone.
