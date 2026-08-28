---
"@vincenthanxiaodu/pi-web": patch
---

Say when a dismissal was refused, and keep a row under the finger that is
reaching for it.

Dismissing took several taps, for two independent reasons.

The daemon is right to refuse an acknowledgement that would clear work the
reader never saw, and a session that completes background work constantly
advances the completion order between the moment the browser reads the catalog
and the moment the reader taps. It refused silently, though: the answer to a
refusal and the answer to an acceptance were both the current catalog, so the
browser removed the row optimistically, the next poll put it back, and nothing
said why. The acknowledgement now reports what became of it, and a browser told
its request was superseded acknowledges the newer order instead of leaving the
row on screen. The chase is bounded, so a session that never stops completing
cannot turn one tap into an unbounded loop.

The activity list also re-sorts on live status every few seconds while rendering
rows by position, so a run finishing moved every row below it and Lit rewrote
the text of whatever element already sat at each index. The control a finger was
travelling towards became a different control mid-tap. Activity rows and
notification rows are now keyed by what they are - the child session, the run,
the task, the notification - so a row that moves takes its element with it.
