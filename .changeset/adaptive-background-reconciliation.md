---
"@vincenthanxiaodu/pi-web": patch
---

Avoid periodic detached-work scans while filesystem watches are healthy and no background work is running, while preserving immediate watcher refreshes and fallback reconciliation.
