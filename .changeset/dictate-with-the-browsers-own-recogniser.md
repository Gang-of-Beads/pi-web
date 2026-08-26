---
"@vincenthanxiaodu/pi-web": patch
---

Add live transcription using the browser's own recogniser

The one streaming path that needs nothing configured, so an install can try
dictation before choosing a service. The browser reports a growing list of
results where settled entries stay put and the last keeps changing, which is
neither socket protocol's shape; it is translated into the same delta and final
events the rest of the code already understands. Interim results are requested
explicitly, without which nothing arrives until the speaker stops - the batch
behaviour this exists to replace.
