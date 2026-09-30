# Round 30 triage: the previous round's own seams, and a ledger that needed a structural fix

Configuration: the same three bllm lanes, auditing the round-29 fix
in-flight. Lane C's headline: the previous wave opened its own seams — the
ladder probe read a signal the round-29 clear removal had made meaningless.
This round's lesson, recorded: every fix wave now gets audited for what it
unmade, not just what it missed.

## Fixed (lane C — the r29 aftermath)

- **F1 (High)**: the retry ladders read `state.error !== ""` as "the
  listing failed"; the only thing that made that sound was the load-start
  clear round 29 removed. With any stale machine-scoped claim on screen,
  every deep-link restore ladder burned to "X is still unavailable." over a
  healthy machine. The probe is now the load's own status field.
- **F2 (Medium)**: local routes still borrowed the machine wording from
  attempt 2 on — the guard covered only the first call. It now lives inside
  setRemoteRouteRestoreMessage.
- **F3 (Medium)**: reader-retired HttpErrors dropped their machine stamp,
  so deleteMachine's retirement identity test could never match — a failed
  archive on machine B outlived B itself. noticeForReader carries the
  machine; the retirement model's reader bucket is now attributable.
- **F4 (Medium-low)**: the unknown-interrupted-runs banner is machine-stamped
  on the state itself and retracts only for its own machine's successful
  read — the private marker could not follow a banner that now survives
  scope switches.
- **F6/F11 (Low)**: two lying comments (the producer-count sentence and the
  banner header's three-exit list) state the shipped truth.

## Fixed (lane B)

- **F2 (Medium-low)**: interrupted-run records are per machine, but the
  adopted set was a single slot — machine B's adoption evicted machine A's
  evidence for the page's lifetime, against the module's own "never erases
  the ones already on screen" sentence. Storage is now a per-machine map
  with a per-machine boot-read mark; the quick switcher reads the browsed
  machine's set.

## Fixed (lane A)

- **F1 (Medium-low, with an erratum)**: TerminalSoftKeys' buttons lose to
  the adopted host sheet — min-height 36→32, mono→UI font, padding,
  touch-action. The r28 lane's re-adjudication of this finding was itself
  wrong (it mis-read the adopted sheet); the r23 original table was right.
  The own rule takes one class, the dialog fix's third instance. The
  coarse-44 question stays with the host-order owner item.
- **F2 (Low)**: SessionTreeNavigator's coarse disclosure draws 24px in a
  20px track — the reservation follows the drawing, in a coarse rule placed
  after every base .tree-row rule.
- **F4 (Low, repeat)**: MachineDialog's bare button rule loses to listStyles
  — mirrored ProjectDialog's scoped fix so the two dialogs read the same.
- **F6 (Low, fourth relapse)**: the capability map's stale line-number
  citations are fixed structurally — all line/range citations stripped from
  evidence cells, ending the whack-a-mole this doc caused four rounds.

## Pending with the owner (unchanged, sharpened)

- **The machine-namespace vocabulary** (rounds 24/28/30): lane B confirms
  the gateway's failing answers (any non-2xx, not just 200-with-ok:false)
  vouch for the machine they were addressed to, and the fleet sweep silently
  swallows the failures that would re-raise. Round-28 page has the repro.
- Phone add-machine affordance; the context sheet's ≥2-machines rule;
  host stylesheet order (now with the TerminalSoftKeys instance and the
  MachineDialog/ProjectDialog divergence as its fifth/sixth live proofs);
  the collapse-toggle chain; QuickSwitcher fetch race; row-fold design.

## Deferred with written reason

- Lane B F4 (identical-text replacement inherits the old expiry's
  remaining life, ≤6s): detecting a same-text replacement needs a
  producer-side claim nonce; the "clear-then-raise" path already re-arms.
- Lane B F3 (named-persistent vs anonymous-expiring contracts for one
  gateway outage): the send-path compose gap already ledgered in r28.
- Lane A F5 / lane B guard-blind-spot extensions: latent, no live offence;
  ledger carried.
