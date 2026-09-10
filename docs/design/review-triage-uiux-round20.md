# Round 20 triage: the seams' two ends, finally wired together

Configuration: the same three bllm lanes against the round-19 HEAD. The
lanes' verdict converged on one meta-finding: the retirement model's sweep
kept stopping one layer short - a classification written but dropped by the
seam that carries it, a scope computed but stamped over, a probe that
verified a different component's menu. Round 20 wired both ends of each seam
and re-proved the result against the surface it actually belongs to.

## Fixed in this wave

1. **Scope tokens redesigned** (lanes B/C, P1): web-owned URLs now vouch
   nothing ("page" claims are the only ones any response disproves); a
   machine's claim is retired only by a response routed to that machine. The
   daemon-down banner survives theme switches; a remote machine's timeout
   survives every other machine's poll.
2. **errorNoticePatch carries the notice's machine** (lanes B/C, P1): the
   ~50 controller producers now write claims the scoping rule can see.
3. **Retirement follows the message's evidence, not the exception's class**
   (lane C, P1): wrapper helpers that re-throw plain Errors no longer convert
   healing claims into imperatives; the duplicate timeout branch is gone.
4. **The last bare producers converted** (lane C, P1): the queued-send guards
   (whose self-destructing data-loss warning was the sharpest edge), the
   replacement-session clear, and both load clears.
5. **The quick switcher's row menu, actually** (lane A, P1): round 19's
   "fix" was again absent from the tree - the round-19 probe had verified
   the machine list's menu, not the quick switcher's. Bound, positioned, and
   re-proven with a probe that opens the real quick switcher surface.
6. **The unread ring's rail entry** (lanes B/C): the ring always wraps a work
   dot, so the dot's state rule is the rail; the purple rule no longer lists
   an entry the cascade could never let win, the comments state the composite
   honestly, and "sending" got its rail entry before the first action-row
   ever carries one.
7. **The interrupted-runs flag is real** (lanes B/C): announcement is
   machine-guarded and the retraction reads the flag, not the banner's own
   wording.
8. **The wire flags have one home** (lane C): CORE_STATUS_FLAGS is exported
   from the plugin API and both plugins import it, so renaming a flag breaks
   the build instead of silently blanking every work mark.
9. **One knip config** (lane C): the duplicated package.json key is gone; the
   dead-code gate runs clean.
10. **The deleted switcher's citations** (lane C): comments, the capability
    map and the design docs now point at what exists.

## Deferred with written reason

- **The persistent-failure pulse** (lane C, P3): a reply-retired claim that
  keeps failing re-arms its 6s expiry each time it re-raises - a flicker, not
  a stick. Inherent to the model; the alternative (expire only after a
  success) is an owner decision.
- **knip cannot see test-only-used exports** (lane C, P2): the gate needs a
  configuration rule change (tests not counting as consumers); recorded as a
  tooling decision.
- **link.live remains unwired** (carried from round 19).
- **pointerQueryOrder's combined-selector equality** (lane B, speculative):
  no live instance found; noted for the guard's next revision.
