---
"@gang-of-beads/pi-web": patch
---

Opening a session is no longer held up by the session list loading in the background. The list used to ask for every workspace's sessions at once. On a machine that had just started, that took over a second and tied up every connection the browser opens to PI WEB, so everything else on the page waited, including the plugins the page loads before it can open the session. The list now asks for two workspaces at a time, and opening a session asks for its conversation first. A large session that was not already open now shows its first messages in about 1.1–1.3 seconds, down from about 2.
