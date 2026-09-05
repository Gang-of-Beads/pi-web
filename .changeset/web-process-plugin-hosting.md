---
"pi-web": patch
---

The web process now hosts the plugins addressed to it. A plugin package can
declare `runs` in its metadata (`daemon`, `web`, or `both`; absent means
`daemon`, so existing packages activate exactly where they always did), and
the web app assembles its own plugin runtime at startup: routes contributed
by web-addressed plugins are mounted under both `/api` and
`/api/machines/local`, the runtime shuts down with the app, and a runtime
that fails to activate (for example, while the daemon profile is briefly
unavailable) starts the web process with those routes honestly absent
instead of taking it down.
