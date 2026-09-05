---
"pi-web": patch
---

Server-plugin lifecycle reconciliation is now process-role aware. The web
process reports its own runtime snapshot alongside the daemon's, so a plugin
addressed to the web (`runs: "web"` or `"both"`) is judged by the snapshot
of the process that actually runs it: a web-activated plugin no longer
shows as missing while the session daemon is unreachable, and a `both`
plugin's browser module only publishes when both processes hold the current
revision, with a restart required when either process has drifted. The
daemon-to-web handshake now forwards the `runs` field, browser-asset cache
freshness follows the web view, a web-only record of a since-removed plugin
renders as undiscovered instead of vanishing, and the route mount uses the
shared request-cancellation helper so a client that disconnects between
request acceptance and handler start aborts the plugin handler too.
