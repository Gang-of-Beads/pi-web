---
"@vincenthanxiaodu/pi-web": patch
---

The activity drawer now starts folded and opens when you tap it, instead of
opening itself whenever work was running or a notification had arrived. The
folded strip still reports what is happening.

Session names get room to show in full on a phone, the session list lays out
as tiles (two columns on a phone), and opening a session no longer leaves the
keyboard up.

The "ended without a reply" badge has been withdrawn. It inferred a stalled
run from the newest record being tool output, but a turn that ends on purpose
looks exactly the same, so it reported ordinary turns as failures. Runs that a
restart or crash actually interrupted are still marked, from a record kept for
that purpose rather than guessed from the transcript.
