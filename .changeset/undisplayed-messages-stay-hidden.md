---
"@gang-of-beads/pi-web": patch
---

Messages meant for the model stop showing as broken ones.

A custom entry whose author marked it undisplayed - goal continuations are the
standing case - was rendered as "Unrecognized message", telling the reader
something was wrong with a message they were never meant to see. Those are
dropped now. Background task notifications, which are meant to be read, get a
renderer from the background-runs plugin: the task name, its outcome and its
exit code.
