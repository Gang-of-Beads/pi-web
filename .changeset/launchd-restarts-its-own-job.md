---
"@vincenthanxiaodu/pi-web": patch
---

A self-update started from the pi-web UI no longer leaves pi-web down.

Restarting a service tore it down and built it up again as separate steps,
which needs the command doing the restart to survive the teardown. An update
started from the UI runs inside the session daemon, so restarting the daemon
killed the updater before it could start anything: both services were left
unloaded, and KeepAlive does not restart a service that is not loaded.

launchd now performs that restart itself, so the caller's death partway
through no longer matters.
