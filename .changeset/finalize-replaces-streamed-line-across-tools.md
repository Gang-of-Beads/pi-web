---
"@vincenthanxiaodu/pi-web": patch
---

An assistant reply no longer renders twice when its own tool runs land between the streamed text and the final message: the finalizer now walks back over the reply's tool rows to replace the half-done line in place.
