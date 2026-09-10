---
"@gang-of-beads/pi-web": patch
---

A banner's lifetime now follows the retirement model instead of the wording.

An HTTP status error used to be treated as a transport complaint, so the next
successful poll - any poll - erased it about 1.5s after it appeared: a red
flash with no explanation. An HTTP status is an answer (the link worked, the
operation failed), so it now stays until the reader dismisses it or another
message replaces it. Genuine link failures keep self-healing, and recovery is
now vouched for per machine: a success from machine A no longer erases
machine B's complaint. The six-second expiry checks the retirement mark
instead of guessing from the wording, and a failed interrupted-runs read says
"status unknown" instead of quietly adopting "none".

The state rail now wears the exact colour the row's own dot wears - running
blue, asking amber, unread purple - so a row reads as one state at any
distance. The machines plugin's compact switcher, mounted permanently hidden
and never displayed since the context row took over, is removed along with
the phantom it put under the UI audit's context trigger.

<!-- ERRATA (round 29): the six-second expiry gates on BOTH the retirement mark and the wording verdict (round 22); and "the rail wears the row's own colour" holds only for non-healthy rows - an online machine row wears success while its dot reads online, by design. -->
