---
"@gang-of-beads/pi-web": patch
---

A web page from another site can no longer make PI WEB act. Before, any page open in the same browser could send a body-less request (for example, stop a session) to a PI WEB it could reach; the browser sent it and only the answer was hidden. Such a request is now refused unless this PI WEB approved the page's origin. Groundwork for connecting to other machines from the browser: another machine's PI WEB page can request access, this machine approves it, and approved pages can then use this machine directly. The approved origins are kept in `machine-access.json` in the PI WEB data directory.
