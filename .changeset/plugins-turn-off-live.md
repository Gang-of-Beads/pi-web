---
"@gang-of-beads/pi-web": patch
---

Turning a PI WEB plugin on or off in Settings now starts or stops its server part right away, so most plugin cards no longer say "Restart required" after a toggle. A plugin turned off stops taking requests at once (they are refused with `409` and `code: "plugin-not-active"`), any work it was doing is told to stop, and its `stop` runs. Workspaces and Machines, a changed plugin `settings` object, a new version of a running plugin, and a hand edit of the config file still need a session-daemon restart. Plugin authors: `stop` can now run while PI WEB keeps running, and the signal an operation or route receives also fires when the plugin is turned off; see "Turning a plugin on or off" in docs/plugins.md. Restart the web service and the session daemon to pick this up.
