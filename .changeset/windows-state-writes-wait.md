---
"@gang-of-beads/pi-web": patch
---

On Windows, PI WEB no longer fails to save its own state when something has the file open for a moment, such as PI WEB itself reading it, an antivirus scan, the search indexer or a backup tool: the save waits up to about a second. Before, a message sent while the agent worked could stay waiting instead of reaching it, and saving unread marks, archived sessions, projects, pins, plugin storage or machine access could fail the same way.
