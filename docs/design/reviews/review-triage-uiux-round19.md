# Round 19 triage: the lanes audited the banner model's own seams

Configuration: the same three bllm lanes against the round-18 HEAD. Round 18
landed its fixes for real; the lanes this time went after the new model's
seams and found the places where the sweep had stopped one layer short.

## Fixed in this wave

1. **The session tree's stylesheet was structurally broken** (lane A, P1):
   the previous round's coarse-floor insertion left an unclosed media block -
   every rule after it was dead on desktop. Fixed and proven with a CSS parse.
2. **The quick switcher's row menu never received its placement** (lanes A/C,
   P1): the previous round shipped a literal style="undefined" - the binding
   was eaten by the fix script's own interpolation. Bound for real, the fixed
   positioning added to the shadow root that does not adopt the shared list
   styles, the long-press path now computes placement too. Live probe on
   8505: the menu carries a computed fixed placement.
3. **The bare-producer sweep was still incomplete** (lanes B/C, P1): the
   queued-send guards and the plugin notice went through the seam; every
   clear now goes through clearErrorPatch, which resets mark and scope
   together - the last stale-scope inheritance paths are closed.
4. **The daemon-restart wording table was unreachable** (lanes B/C, P2): a
   gateway 502 is an HttpError, so it was reader-retired and the rewrite gate
   never opened - the commonest banner showed raw ECONNREFUSED forever. An
   HttpError whose text is a transport claim keeps reply retirement.
5. **A timeout now carries its machine's scope** (lane C, P2): the URL the
   RequestTimeoutError failed on names the machine.
6. **A 500 response now reports reachability** (lane C): any answer from the
   origin disproves that the link is down, not only a parsed success.
7. **The reader's dismissal is decisive** (lane B): the 1.5s hold window
   exists for replacement churn and can no longer resurrect a dismissed
   banner; a cleared-then-returned banner re-arms its own expiry.
8. **Interrupted-run markers carry their machine into the render** and the
   unknown banner's retraction tracks a flag, not a wording match <!-- ERRATUM (round 29): the flag path died with round 26's cleanup; the retraction is an identity match on INTERRUPTED_RUNS_UNKNOWN_MESSAGE plus the machine whose read raised it. -->
   (lanes B/C).
9. **Guards extended** (lane A): multi-condition media blocks, and the tree
   dialog's 30px literals became spacing tokens.

## Deferred with written reason

- **link.live remains unwired** (lanes B/C, P2): who owns liveness evidence
  is a seam decision; operation-model.md now says so in place.

## Verdict

The finding classes are now: the model's own seams, and leftovers of the
removals. Round 20 runs the same configuration.
