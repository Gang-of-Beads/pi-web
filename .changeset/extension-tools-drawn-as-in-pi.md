---
"@gang-of-beads/pi-web": patch
---

A tool a pi extension draws itself (with `renderCall`/`renderResult` on the tool, or a `registerToolRenderer` resolver) now shows that drawing in its tool card in the conversation, as in pi's terminal: the call's lines as its input and the result's lines as its result, live and after a reload. pi's built-in tools keep PI WEB's own cards. Restart the session daemon and reload the page.
