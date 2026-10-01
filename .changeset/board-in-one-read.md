---
"@gang-of-beads/pi-web": patch
---

The session board loads with one request. To list a machine's sessions, the page used to ask for each project's workspaces and then for each workspace's sessions, which is 14 requests for 6 projects, all competing with the rest of the page for the browser's few connections. The machine now answers the whole board at once. A project or workspace that does not answer is still shown as not answered, never as empty. A remote machine on an older version is read the old way. This machine's web server needs a restart; the session daemon does not.
