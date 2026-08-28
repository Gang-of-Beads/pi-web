---
"@vincenthanxiaodu/pi-web": patch
---

Stop a finished dictation from reporting a failure afterwards.

Stopping a live dictation closed its socket but left the handlers attached.
Closing is not immediate, so a socket that failed on the way down still ran
`onerror` and put "The dictation connection failed." above the composer — for a
dictation the user had already finished, next to a composer they were no longer
dictating into. A socket still connecting when the user stopped was left open
entirely, because `close()` does nothing in that state.

Stopping now drops the handlers before closing, and closes a still-connecting
socket once it opens.
