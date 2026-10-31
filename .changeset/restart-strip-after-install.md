---
"@gang-of-beads/pi-web": patch
---

When a newer PI WEB is installed but the server has not been restarted (for example after `npm install -g` without `pi-web restart`), the strip above the session now says so, naming the web server or its session daemon, and offers Open Updates to restart (with another machine selected, it names the machine serving the page instead), instead of an endless Reload. The strip keeps its Reload button, and you can close it until the versions change.
