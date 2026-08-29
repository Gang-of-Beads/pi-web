---
"@vincenthanxiaodu/pi-web": patch
---

The first paint stops carrying the composer's editor. CodeMirror core and languages - 649KB of vendor chunks - were modulepreloaded from index.html, so every page waited on an editor nobody had focused yet. The editor module now loads when the composer mounts: measured after, the preload list carries 0KB of editor, and typing in a live session still lands.
