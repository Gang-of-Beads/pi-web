---
"@gang-of-beads/pi-web": patch
---

Archive, restore, delete permanently, close project, remove machine, remove Pi package, remove page access, session cleanup and remove workspace now act at once with an Undo bar instead of a confirmation dialog. The item moves where it will be (an archived session into Archived) and goes back with the machine's reason if it refuses; everything that cannot be undone on the machine is held for the five-second Undo window and sent only when it ends, with any warning (such as uncommitted work in a workspace) shown in the bar. Archiving the session you are reading, directly or through a session cleanup, keeps it open, read-only, with its Restore strip.
