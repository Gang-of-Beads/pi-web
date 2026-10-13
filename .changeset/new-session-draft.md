---
"@gang-of-beads/pi-web": patch
---

New session opens an empty draft: nothing is created on the machine until its first message, so leaving it leaves nothing behind. Every New session entry says where the session will start before you press it: "New session in <project>" when the list is narrowed to a project, and "New session… Choose a project" under All projects, with no project open, or when browsing another machine; it no longer starts silently in the project selected before. Choosing asks in a dialog that offers a new project first and lists the machine's projects as the Projects page does, the one used last first; a new project opens its first session itself. The draft's title and empty page name its project and machine. Deleting a draft drops what it was still sending. Choosing a machine on the Navigate page switches to it.
