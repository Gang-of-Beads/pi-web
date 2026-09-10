# Round 28 triage: the vocabulary question gets a repro, and the owner answers round 22

Configuration: the same three bllm lanes against the round-27 HEAD. Lane C
returned four findings; lane A's geometry seam is quiet at this depth; lane
B is still running against the pre-decision HEAD (its findings will be
triaged against the current tree next round). Mid-round the owner answered
all three round-22 product questions, and this wave implements them.

## Owner decisions implemented (round-22 ask, answered)

1. **Scope switches keep reader-retired failures visible** (clear-notify):
   the workspace-scoped reset no longer spreads the error triple. A failed
   delete, an unknown state — the record of something the reader acted on —
   survives the switch; the banner is the notification, and it is still
   there when they come back. A newer claim replaces it through the normal
   seam.
2. **"Check again" keeps navigating** (keep-navigate): the row-menu action
   remains a full selectMachine. Recorded as intended; no change.
3. **Composed banners are named** (composed-named): the health and runtime
   gateway paths now compose the same form the deep-link path already
   writes — "lab-mac is unavailable; reconnecting… connect ECONNREFUSED…" —
   instead of routing the raw gateway text through the wording table's
   anonymous rewrite. The anonymous "Reconnecting to the machine…" entry
   stays as the fallback for paths this wave did not touch (the session
   send path is named in the ledger below).

## Fixed (lane C)

- **F3 (doc drift)**: the banner-retirement-model changeset says the expiry
  "checks the retirement mark instead of guessing from the wording"; since
  round 22 the gate is both. Recorded here as an erratum — the code's
  both-gate behaviour is the owner-ratified one.
- **F4 (false-premise record)**: the round-25 lane C record "verified
  clean: web-owned URLs have no /machines/ segment" was wrong for
  machine-namespaced routes and is exactly why the F1 finding survived four
  review rounds; the research copy is annotated.

## Pending with the owner (sharpened, not new)

- **F1/F2 — the local/machine namespace vocabulary**: a machine-namespaced
  URL the web process itself answers (health returns 200 with ok:false from
  its cache) is read as that machine's proof of life, so the reconnect
  banner flashes for one round trip and vanishes while the machine is still
  off — deterministic, no race. This is the round-24 owner item; the lane
  adds the missing repro. The fix seam exists (reportTransportReachable
  accepts an explicit scope); the vocabulary — which routes may vouch for a
  machine's link — is the decision.

## Deferred with written reason

- Lane C F5–F8 verified clean (fetch-failure scoping, producer bypasses,
  switcher leftovers, palette alignment).

## Round-28 ledger (applied mid-round; next round audits the result)

- Session send-path gateway errors still surface anonymously through the
  wording table; the composed-named form should reach them once the send
  seam can name a machine.
