---
"@vincenthanxiaodu/pi-web": patch
---

Arriving in a conversation on a touch device no longer raises the keyboard over
it. Switching session, closing a dialog and restoring a queued message each
reached for the composer directly, past the rule that was supposed to withhold
focus.

The session name now gets the room in a phone header, instead of a few
characters beside a machine-and-project trail that rarely changes.

The expanded activity drawer keeps a way back out. It covered the screen, and
the app header painted over the drawer's own header, taking the only control
that closes it.

A message queued while a reply was running stays below that reply. It carries
the moment it was typed, not the moment it was sent, so ordering by timestamp
lifted it above the answer it had been waiting for.
