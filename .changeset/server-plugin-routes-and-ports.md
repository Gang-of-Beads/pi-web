---
"pi-web": patch
---

Server plugins can now declare routes and receive host ports. The activation
contract gains `routes` (core-shaped paths the host mounts under both `/api`
and `/api/machines/local`, with streaming answers expressible as async
iterables) and an optional `ports` object (workspace-catalog and per-project
config lookups today). A route handler's signal is request cancellation and
is never bounded by the lifecycle timeout; a route whose path is named by
the federated route table inherits that entry's transport bounds. An
activation carrying unknown fields is warned about instead of silently
dropped, so an older host running a newer plugin says so out loud.
