---
"@gang-of-beads/pi-web": patch
---

A Pi extension can now tell PI WEB what a session is still doing after its turn ends. It declares a `piweb:states:<name>` channel under `piWeb.bus` in its `package.json` and publishes a list of states on `pi.events`; the session lists and the chat status line then show the session as busy, in the extension's own words (for example "2 runs going") instead of a bare "idle". No PI WEB server plugin is needed, and the same extension is unaffected in the terminal. Subsessions and the background runs plugins already report are shown the same way. Restart the session daemon after upgrading.
