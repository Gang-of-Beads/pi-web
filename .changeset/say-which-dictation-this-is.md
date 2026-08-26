---
"@vincenthanxiaodu/pi-web": patch
---

Say whether dictation will write as you speak

Batch dictation says nothing until it is stopped; live dictation writes as it
hears. The control looked identical either way, so there was no way to know
which one you were speaking into until you had already spoken. It now reads
"Dictate live" when streaming is configured, and keeps the plain label
otherwise. Once capture is under way both read "Listening…", because by then
the mode no longer matters.
