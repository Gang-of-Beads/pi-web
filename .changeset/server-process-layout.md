---
"@vincenthanxiaodu/pi-web": patch
---

Reorganize `src/server` by process ownership: modules loaded only by the web/API process now live under `src/server/web/`, session-daemon-only modules under `src/server/daemon/`, and modules shared by both processes under `src/server/shared/`. The former `src/sessiond/` daemon client moved to `src/server/shared/sessiondClient/`, and the mixed `src/server/sessiond/` directory was dissolved into its web and daemon sides. Entry points (`src/server/index.ts`, `src/server/sessiond.ts`) and published bin paths are unchanged; no runtime behavior changes.
