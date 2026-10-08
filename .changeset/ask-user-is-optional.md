---
"@gang-of-beads/pi-web": patch
---

`ask_user`, the tool that lets an agent post a question form to your browser, is now an optional extension and is off by default. To keep using it, turn on **Settings → Session daemon → Allow agents to ask questions** (or set `askUser` to `true`), then restart the session daemon. A machine that already sets `askUser` keeps that setting.
