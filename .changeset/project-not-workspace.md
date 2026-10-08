---
"@gang-of-beads/pi-web": patch
---

PI WEB now says "project" where it used to say "workspace": a project has one folder, and the app has no other kind of workspace. For example, "This project's folder no longer exists, so a new session cannot start here.", "No goals in this project.", "Select a project first", and the upload folder setting is now project-relative. Messages about removing a git worktree still say workspace. Restart the web service and the session daemon to pick it up.
