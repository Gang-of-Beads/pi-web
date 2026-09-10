# Round 28 triage: the vocabulary question gets a repro, the owner answers round 22, and a swallowed brace

Configuration: the same three bllm lanes against the round-27 HEAD
(a5d3f390). Mid-round the owner answered all three round-22 product
questions (shipped as 0ae86be1); this wave implements the lanes' findings
on top.

## Owner decisions implemented (round-22 ask, answered)

1. **Scope switches keep reader-retired failures visible** (clear-notify):
   the workspace-scoped reset no longer spreads the error triple. The
   banner is the notification, and it is still there when they come back; a
   newer claim replaces it through the normal seam.
2. **"Check again" keeps navigating** (keep-navigate): the row-menu action
   remains a full selectMachine. Recorded as intended; no change.
3. **Composed banners are named** (composed-named): the health and runtime
   gateway paths compose the same form the deep-link path already writes —
   "lab-mac is unavailable; reconnecting… detail" — instead of the
   wording table's anonymous rewrite.

## Fixed (lane A)

- **F1 (P2, regression + accounting)**: round-25's relays coarse floors
  never fired — the insertion swallowed .document-tab.active's closing
  brace, nesting the @media block inside it, so the floors' real selectors
  were descendants of the active tab and matched nothing (lane verified in
  Playwright: computed 32px/0px). This is the second time a coarse-floor
  insertion script broke stylesheet structure (round 19: unclosed media;
  round 25: accidental nesting). The brace is restored and the media block
  stands alone.
- **F2 (P2)**: round-27's updates-panel floors died on arrival — the bare
  template's button rule ties the adopted host sheet on specificity and
  loses by order, the mirror side of the recorded host-stylesheet-order
  owner item. The floors now carry one class (.updates-panel), the fix the
  dialog buttons took.
- **F3 (Low)**: boxModelGuard's border-0/none exemption never fired —
  \s* backtracking defeated the negative lookahead ("border: 0" matched
  BORDERED). The lookahead now sits before the whitespace. False-positive
  direction only; no live offence today.
- **F4**: not re-filed — a fourth live instance of the shelved host-sheet
  order item (TerminalPanel base button padding) is added to that ledger.

## Fixed (lane B)

- **B-1 (Medium)**: five late-failure banner writes (deliver prompt/shell/
  command, two archive paths) had no selection guard — a 30s deadline or a
  gateway 4xx arriving after a machine switch repainted machine A's
  complaint onto machine B, the exact "replay" PiWebApp's own design
  sentence forbids. The guards now match their sibling transcript writes;
  reader-retired 4xx no longer lands on the wrong context as an unexpiring
  page claim. The inverse tradeoff (the leaving reader sees nothing) is
  the recorded seam; the transcript row already says what happened where it
  belongs.
- **B-3 (Low)**: the retraction consumes interruptedRunsReadPlan's
  resolveUnknown — the module computed it precisely so this callback stays
  an executor; round-26's "decision lives in one tested module" claim is
  now fully true.
- **B-4 (Low, ledger closes r22-B6)**: a successful XHR upload vouches for
  the machine it touched (reportTransportReachable), and the fixed
  "Workspace upload failed" sentence no longer replaces the network
  evidence.
- **B-5 (Low)**: operation-model.md's three round-27-drifted passages (page
  -level deadline banner, the NO_NOTICE branch described as existing, the
  errorNoticePatch link argument) now describe the shipped code.

## Pending with the owner (sharpened, not new)

- **F1/F2 (lane C) / B-2 — the machine-namespace vocabulary**: a
  machine-namespaced URL the web process itself answers (health returns 200
  with ok:false from its cache) is read as that machine's proof of life, so
  the reconnect banner flashes for one round trip and vanishes while the
  machine is still off — deterministic, no race; plus three no-re-raise
  paths and a boot composed-claim flicker. The lane adds the repro and the
  second principle ("report only when the response truly touched the
  machine"); the vocabulary decision remains the owner's.

## Deferred with written reason

- Quick switcher fetch race (r26), boot interrupted-runs race (r23),
  restore-ladder shared banner (r23), knip test-only blind spot — carried.

## Errata

- Round-25's changeset and commit message claim the relays floors were
  delivered; lane A proves they were structurally dead until this round.
  Recorded on the page; the r25 page gains a pointer.
- The banner-retirement-model changeset's "checks the mark instead of
  guessing from the wording" predates round 22's both-gate; recorded as
  erratum (code's both-gate is the owner-ratified shape).
- The round-25 lane C "verified clean" note about web-owned URLs and the
  /machines/ segment was wrong for machine-namespaced routes — annotated in
  the research copy; it is why the vocabulary finding survived four rounds.
