---
"@vincenthanxiaodu/pi-web": patch
---

The first paint stops carrying the editor. CodeMirror core and languages - 649KB of vendor chunks - were modulepreloaded on the critical path, so every page load waited on an editor nobody had focused yet. The editor now loads when the composer mounts: measured after, the preload list carries 0KB of editor code, and typing in a live session lands exactly as before.
