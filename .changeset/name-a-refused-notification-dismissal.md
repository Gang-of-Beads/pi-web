---
"@vincenthanxiaodu/pi-web": patch
---

Stop losing the first tap on a notification after the daemon restarts.

Dismissing a notification took two taps whenever the browser tab had been open
across a daemon restart. The tab sends the daemon instance id it read when it
loaded the inbox; the daemon mints a new one every time it starts; the store
compared the two, refused, and answered 200 with the current inbox and nothing
to say it had refused. The row was removed optimistically, the next poll put it
back, and the reader tapped again. The second tap worked because the refusal had
carried the current id, which the client installs — so the cost was exactly one
silent wasted tap per restart, on a phone that keeps a tab open for hours while
this daemon restarts on every update.

For a single dismissal the guard was protecting nothing. A notification id is
minted as `${daemonInstanceId}:${order}`, so it already names one notification
of one instance and cannot reach a newer one; naming a notification the daemon
never minted simply finds nothing. That dismissal is now accepted whatever
instance the caller last saw.

Dismiss-all is not the same and keeps its guard: it names an order range rather
than an id, and order restarts at zero with the process, so a range read before
a restart covers notifications the reader has never seen. Measured on the real
store, an accepted stale range would have cleared an unseen notification. The
refusal now names itself instead of being silent, and the client reissues once
against the range the refusal reports, so the inbox still clears in one gesture.

This is the same fault, and the same fix, as the unread acknowledgement one
release earlier; both stores now report the outcome of a dismissal rather than
declining in silence. These are the only two places in the server that refused a
request on a stale identifier with an empty result.
