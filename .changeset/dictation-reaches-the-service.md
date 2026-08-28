---
"@vincenthanxiaodu/pi-web": patch
---

Dictation reaches the transcription service again. The browser refuses `fetch` called with anything but the window as its receiver, and it was being handed to the transcriber inside a dependency object, which made every call a method call on that object: "Could not reach the transcription service: Failed to execute 'fetch' on 'Window': Illegal invocation".

The activity tab counts what is running rather than everything that ever ran, so a session with nothing in flight no longer shows a number that reads as work waiting for you.

The conversation stops following the newest message while your finger is down, so a button does not move out from under a tap.
