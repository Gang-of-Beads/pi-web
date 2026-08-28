---
"@vincenthanxiaodu/pi-web": patch
---

Say what failed, and let a reply withdraw the saying of it.

A red banner reading the single word "HttpError" could sit above a session that
went on replying normally, with the dismiss button as the only way out. Nobody
wrote that text. Over HTTP/2 `response.statusText` is always the empty string,
so a response whose body carried no error field built an error with an empty
message, and an Error with a name and no message stringifies to just its name.
The banner was showing a class name.

It stayed because the field that marks a complaint as one a successful reply
disproves was never set. It was introduced with the notice module, defaulted to
"only the reader can clear this", and no call site ever set it, so the code that
withdraws such a complaint returned early every time.

Both halves were decided independently at every call site: 60 of them, built by
hand out of `String(error)`. They now go through one function that returns the
words and the lifetime together, so neither half can be set without the other
and a call site added later cannot reintroduce either fault. A failure that
describes itself is quoted as it is; one that does not is described by its
status instead of by its class.

Reported failures lose their `Error: ` prefix, which was the same class name
leaking through in a smaller way.
