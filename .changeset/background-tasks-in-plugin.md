---
"@gang-of-beads/pi-web": patch
---

Background shell tasks (pi-background-tasks' `bg_run`) are now read by the Background runs plugin instead of PI WEB itself. The Background panel lists the same tasks; a newly started task is counted in "N background runs" within about half a second. Turning the Background runs plugin off removes its panel, stops counting its tasks, and lets the Files and Git panels refresh on the task output it writes under `.pi/tasks`. For plugin authors: the browser plugin state no longer carries `backgroundTasks` or `backgroundTasksRead`; read tasks through the Background runs plugin's `tasks.list` operation. Restart the session daemon and reload the page to pick it up.
