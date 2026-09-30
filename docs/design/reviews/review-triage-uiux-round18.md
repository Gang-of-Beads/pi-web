# Round 18 triage: the lanes audited the round-17 fixes, and caught two of them lying

Configuration: the same three bllm lanes against the round-17 HEAD. The
headline is not a defect but an accounting failure: the round-17 triage
claimed "fixed by ordering" and "fixed in the guard" for the self-update
banner's dead coarse floor and the pointer-query guard's first-rule blind
spot, and neither edit had been made - the fix script printed a false
verification flag that went unread. Both landed for real this round, and the
guard's first catch, run against the deliberately restored broken order, is
the dead floor itself.

## Fixed in this wave

1. **The dead coarse floor, actually fixed** (lanes A/B/C agree): the base
   rule now sits above the media block. The guard catches the broken order -
   proven red-then-green, not asserted.
2. **The guard's first-rule blind spot, actually fixed** (lanes A/B): the
   extraction slices past the media block's own brace.
3. **The phone header mounted a second, visible machine list** (lanes A/C):
   removing the switcher's render branch left the header call site alive, and
   without the hidden branch it now rendered the whole fleet twice. Call site
   and helper removed; the compact panel test now asserts one list. Live
   probe on 8505: one machine-list, none visible in the header.
4. **The rail's unread class beat every state rule** (lanes A/C): the
   (0,2,0) row-class rule painted working rows purple over a blue dot. The
   dot rules are the only unread painters now; the comment states the
   specificity honestly. background state and the activity unread dot joined
   the same purple vocabulary.
5. **errorNoticePatch carried no machine scope** (lanes B/C): a stale scope
   could clear one machine's banner on another machine's success. The seam
   now always writes the scope, and a cleared banner resets it.
6. **Self-update failures inherited a stranger's retirement mark** (lane C):
   they go through the seam as reader-retired; the dead expiry call is gone.
7. **The interrupted-runs banner replaced the reader's banner on every
   reconnect** (lane C): it now only announces onto a quiet screen and
   retracts itself when the state is known again; markers carry their
   machine.
8. **Bare error writes skipped the seam** (lane B): every remaining
   "setState({ error })" producer now travels with its retirement mark.
9. **The banner hold/expiry state machine** (lanes B/A): a replacement starts
   its own hold window and expiry; leaving the screen resets the schedule.
10. **The quick switcher's row menu** (lane A, round-17 back-account): fixed
    and viewport-constrained like every other row menu; the tree dialog's
    disclosure and close buttons got their coarse floors.
11. **Dead code and doc drift** (lanes B/C): the core activityBadge render
    half (forked into the plugins long ago), the dead idle-unread green rule,
    the operation-model anchor, the switcher mentions, the audit's phantom
    "Switch" term.

## Deferred with written reason

- **link.live is never passed in production** (lane C, P2): the timeout
  suppression branch is unreachable. Wiring the socket verdict into the
  notice layer is a seam decision (who owns liveness evidence); recorded
  here and in operation-model's not-yet list.
