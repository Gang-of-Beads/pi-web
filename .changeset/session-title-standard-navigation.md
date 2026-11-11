---
"@gang-of-beads/pi-web": patch
---

Open standard navigation from the session title instead of a separate project picker, using the side panel on desktop and the navigation page on phones. The title entry follows the same list layout preferences, including two tiles per row, and navigation overlays keep focus inside and close with Escape.

Retire the legacy built-in workspace-management sheet: its list of a project's workspaces and worktrees, removing a worktree, and its workspace labels and per-worktree trust/details controls. Another folder of a project is still listed in keyboard session search; on a touch screen, add it as a project. Existing folders, Git links, sessions and saved trust decisions are unchanged; plugins can provide their own workspace pages through the existing generic APIs.
