---
"@gang-of-beads/pi-web": patch
---

The machine scope a producer chose survives classification, and expiry stops
contradicting what messages render as.

A gateway 502 that names the machine it failed for was stamped page-scoped by
branch order: any other machine's success erased the banner, and the rewrites
deleted the machine's name from the text. The scope now follows the evidence
the error carries - the body's machineId, else the machine the URL speaks
about - and a message the wording layer declines to shorten (a composed
"X is unavailable; reconnecting… <detail>", the retry ladder's terminal
sentence) stays until its machine's answers or the reader retire it, instead
of being deleted six seconds in while styled as permanent. A late background
health failure can no longer paint machine A's complaint onto machine B, the
hold window re-arms an identical returning failure, and a sessiond restart's
banner survives other machines' polls. Also: three width:100%-with-padding
overflows are border-box, the spacing guard sees logical properties, the
session list clears its filter when hidden like the plugin lists, and the
dead machineStatuses property and 26 orphaned CSS rules are gone.
