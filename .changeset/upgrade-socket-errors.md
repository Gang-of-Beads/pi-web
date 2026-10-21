---
"@gang-of-beads/pi-web": patch
---

Keep the session daemon and the web server running when a client hangs up on a WebSocket upgrade before it is answered. An upgrade to a route the process did not have (for example a newer web server reaching an older session daemon) could crash the daemon and stop every session on the machine. Both processes now guard every upgrade socket, and the lockfile moves `@fastify/websocket` from 11.3.0 to 11.3.4, which guards the same socket upstream (since 11.3.2): Nix and other builds from `pnpm-lock.yaml` were still pinned to the unguarded 11.3.0, while npm installs already resolved a guarded release.

A web server newer than its session daemon no longer retries the daemon's missing server-facts route every few seconds: it checks the daemon's version first, backs off to once every five minutes, and connects as soon as the daemon restarts onto a version that has the route.
