---
"@gang-of-beads/pi-web": patch
---

Session lists are sectioned and ordered the same way everywhere. The Navigate page and the session search show Pinned, Active and Archived, each foldable and remembered per list; Archived always shows its count, even at zero. Inside a section, sessions that failed come first, then those asking for you, then unread replies, then running sessions, then the rest, newest activity first; a running session keeps its place until its run ends, and a list never re-sorts under your finger. Plugins can add their own sections.

The grid key goes back to the page you came from, and is only a "you are here" mark when there is nowhere to go back to. A `<project> | All projects` switch narrows or widens the list in one tap. On a phone, a chosen project's Navigate page has the same Go to menu as a chat, which also gains an Actions… line that opens the action palette. The desktop start page says "Open a session on the left, or start a new one." with a button that starts a session in your most recent project, or asks for a project first. Reload the page to pick this up.
