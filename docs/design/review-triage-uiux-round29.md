# Round 29 triage: the owner decision lands twice, a ladder learns honesty, and the capability map's third relapse

Configuration: the same three bllm lanes against the round-28 HEAD
(2851f3fb). Lane B's headline is the round-28 owner decision not yet
reaching the code: machine switches and browser resume both pass through
loadProjects, whose first act was an unconditional clearErrorPatch — so
"leaving a workspace or machine no longer silently clears the banner" was
true for exactly the workspace path.

## Fixed (lane B)

- **B-1 (Medium)**: a load start is not a retirement event. The clear is
  out of loadProjects; a failure replaces the banner, the reader dismisses
  it. Machine switch, browser resume and the boot path now all honour the
  owner's call; workspace and machine switches behave the same way.
- **B-2 (Medium-low)**: the boot failed-listing ladder promised
  "reconnecting…" to local routes its own guards refuse, then died at the
  first retry. Local routes now belong to the ladder honestly: no
  machine-name banner (loadProjects' catch raises the honest one), no
  health probe (the listing IS the probe), and the still-current guard
  accepts the local machine like any other. The remote walk is unchanged,
  and the caught-live local deep link (bootRestore.test) still retries.
- **B-5 (Low)**: the interrupted-runs flag comment orphaned by round 26 is
  gone; the retraction states its real rule — an identity match on the
  feature's private wording AND the machine whose read raised it, the
  machine dimension added because banners now survive scope switches (a
  success from machine B may not clear machine A's unknown banner). The
  round-19 page carries the erratum.
- **B-6 (Low)**: the renderErrorBanner comment claiming "a machine or
  workspace switch clears the banner through the reset" is rewritten to the
  shipped truth: the switch resets only the hold bookkeeping.
- **B-8 (Low, latent)**: the dismissal one-shot no longer swallows a claim
  that arrives between the dismissal and the next render — a new claim
  shows; the one-shot waits for a quiet screen.

## Fixed (lane A)

- **F1 (P3)**: the coarse row gutter reserved 36px while the drawn toggle
  is 44px — the text met the toggle's right edge with zero breath, against
  the stylesheet's own derivation contract. The reservation follows the
  drawing (touch), and the selecting formula stops computing against
  comfort.

## Fixed (lane C)

- **F2 (Medium)**: the hidden-attribute guard protected one element and
  missed the one it was written for — machine-list is defined outside the
  scanned directory and hidden by a property binding the regex could not
  see. The guard scans both roots and both syntaxes, and sees the adapter
  spelling (host.listStyles through machines' hostUi).
- **F1 / lane-a F2 (Low)**: MachineList's add control renders nowhere —
  every surface passes withCreate: false. The lying comment is replaced
  with the truth (live add routes are the context chip's + and Settings);
  whether phone surfaces should turn the flag on is an owner question, not
  a unilateral fix.
- **F3 (Low)**: the composed-prefix comment names one producer; three
  exist. The comment now names the count and the sites.
- **F7 (Low, third relapse)**: the capability map's stale citations are
  fixed beyond the one line round 27 touched — MachineSwitcher rows,
  out-of-range AppContextBar lines, deleted-file rows, GoalPanel line
  spans — with a historical note where the evidence chain is genuinely
  gone.

## Pending with the owner

- **The machine-namespace vocabulary** (rounds 24/28; lane-b B-3 and B-7
  add instances): web-process answers on machine-namespaced routes vouch
  for machines; roster failures wear machine names. The deterministic
  repro is on the round-28 page.
- **Phone add-machine affordance**: should any phone surface pass
  withCreate: true (lane C F1 / lane A F2)?
- **The context sheet's ≥2-machines rule** (lane C F6): the nav panel
  deliberately retired it; the phone sheet still imposes it. Consistency
  is a product call.
- Host stylesheet order (fourth live instance recorded round 28), the
  collapse-toggle chain, QuickSwitcher fetch race, row-fold design.

## Deferred with written reason

- Lane-b B-4 (pointerQueryOrder single-match/element-selector blind spot):
  latent, no live offence; ledger carried.
- Lane-c F4/F5 (changeset overstatements): errata comments recorded on the
  changeset itself — changesets are consumed at release; the code's
  behaviour is the owner-ratified shape.
