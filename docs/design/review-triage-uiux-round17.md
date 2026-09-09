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
   rule sat after the media block. **Fixed** by ordering, and the guard that
   should have caught it is fixed too (next item).
2. **pointerQueryOrder never checked the first rule of a media block** (lane
   A, low-medium): the extraction anchor required a preceding brace, so the
   first raised rule in every block was invisible. **Fixed** in the guard, and
   F1 is its first catch.
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

## Deferred to the owner (product semantics, with the round-17 evidence)

1. **Banner retirement model** (lane C, P1): every HttpError is reply-retired,
   so any successful poll erases a real failure ~1.5s after it appears. The
   lane's direction - HttpError means the server was reached, so it should be
   action- or reader-retired, and reportTransportReachable should vouch for a
   machine, not the world - is a semantic decision about what a banner owes
   the reader.
2. **Rail colour vocabulary** (lane B/C, medium): running renders a blue dot
   and a green rail, asking an amber dot and a green rail, unread purple in
   one list and accent in another. Aligning dots and rails is the palette
   owner's call.
3. **Machine-switcher mounted permanently invisible** (lane C): delete it or
   make the phone header actually use it.
4. **Interrupted-runs failure reads as absence** (lane B): a failed load
   returns the empty set the daemon's "none" returns; adoption is verbatim.
   Honesty fix, low severity.
5. **ScheduleTransientErrorDismissal ignores retired-by** (lane C): expiry by
   text shape races the retirement model; fold into the same decision as (1).

## Verdict

Round 17 was not clean: the lanes are now reporting almost entirely
pre-existing debt rather than new-wave defects, which is what a convergence
loop looks like as it approaches the real floor. Round 18 runs the same
configuration; the banner-lifecycle decision above is the largest remaining
owner item inside the reviewed surface.
