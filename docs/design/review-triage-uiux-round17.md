# Round 17 triage: three lanes, not clean, the findings are changing shape

Configuration: the same three bllm lanes against the round-16 fixed HEAD. All
three re-verified rounds 15 and 16's fixes first: every one still in place.

## The shape of this round

The findings are no longer in the wave's own work. They are in two
pre-existing systems the wave's fixes walked past: the banner lifecycle
(notice/retired-by/normalizer/two independent withdrawal mechanisms) and the
state rail's colour vocabulary. Plus three guard blind spots, one of which
had let a real dead floor through CI.

## Fixed in this wave

1. **Self-update banner's coarse floor was dead** (lane A, medium) - the base
   rule sat after the media block. **Claimed fixed by ordering here; the
   round-18 lanes proved the edit never landed, and it was actually made in
   round 18** - see the round-18 triage, which also corrects item 2.
2. **pointerQueryOrder never checked the first rule of a media block** (lane
   A, low-medium): the extraction anchor required a preceding brace, so the
   first raised rule in every block was invisible. **Claimed fixed here; not
   landed until round 18.** Also corrected here: the round-17 lane A findings
   for the quick switcher's clipped row menu and the tree dialog's touch
   floors were true and missing from the fixed list below; both were fixed in
   round 18.
3. **The remote-route-restore banner pasted itself into itself**, once per
   retry of the ladder (lane C, P1): the detail read `state.error` back.
   **Fixed** - the detail is what the health read reported, never the banner's
   own text.
4. **Unpaired error producers converted** (lane B/C): machineController's two
   sites and sessionController's four now travel with their retired-by mark.
   openSettings' stale docstring corrected; inFlight's sharing docstring now
   states the convention instead of promising enforcement.
5. **Deferred-pointer repair** (lane B, low): the focus-contract record now
   exists in surfaces-as-plugins, where the round-16 triage said it was.
6. **Rail comment** no longer promises an upload colour the deleted rule used
   to carry (lane B, low).
7. **Round-16 accounting** (lane A): the triage page now states its counting
   basis - fourteen items, ten fixed, four deferred.

## The owner's five decisions (2026-09-09, all implemented)

1. **Banner retirement model** - HttpError is an answer, not silence: the link
   worked and the operation failed, so it is reader-retired. Link-level
   failures (fetch rejection, timeout) keep reply retirement, and the report
   of recovery now vouches for the machine the URL addressed - a success from
   machine A no longer erases machine B's complaint.
2. **Rail follows dot** - the rail wears the very colour the row's dot wears:
   running accent, asking warning, unread purple. A row no longer reads as one
   colour up close and another at scanning distance.
3. **MachineSwitcher** - the owner's rule: plugin if it can stand alone, core
   if it needs core cooperation. The component is a self-contained plugin
   element; the permanently hidden mount was core's compact panel keeping it
   invisible while the context row took over machine picking. Dead mount
   removed; the plugin keeps delivering switching through its list. (It had
   also been the UI audit's phantom context trigger - the drill now targets
   the real context row, with a bounded poll so a late render cannot read as
   absence.)
4. **Interrupted-runs** - a failed read returns 'unknown', not the daemon's
   empty record: the previous markers survive and the banner says so.
5. **Six-second expiry** - decided by the retirement model, not by matching
   the wording: only reply-retired claims expire on the timer.
