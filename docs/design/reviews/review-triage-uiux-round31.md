# Round 31 triage: the one banner a reader could not dismiss, and the stamps that stopped at the seam

Configuration: the same three bllm lanes against the round-30 HEAD. Lane C
came back with "not clean" for the first time in five rounds — both new
findings sit in the self-update surface, the one corner the retirement
model never reached because it is a host-owned strip, not a notice.

## Fixed (lane C)

- **F1 (Medium)**: the "applying" self-update strip had no exit —
  `selfUpdateApplying` was set on `started: true` and never cleared; a
  restart onto the same version (rollback, pinned resolution) left a
  blinking strip occupying the top of the screen forever, with no Skip, no
  Reload, no dismiss. Its exit is the socket reconnecting to the same page,
  and that hook now clears it.
- **F2 (Medium)**: "Update now" is the highest-probability path to exactly
  the staleness the stale-client banner exists for, and the one path that
  never re-probed: the server restarts, the socket reconnects, the reader
  never left the tab, so no visibility hook fires. The reconnect now re-runs
  the freshness check — which also gives F1's exit a truthful follow-up.
- **F6 (Low, doc)**: transportHealth's docstring promised machine ids come
  back undefined for web-owned URLs "not even the local one" — while the
  rule extracts `local` from `/machines/local/` like any other machine.
  The docstring now says what the rule does and names the pending vocabulary
  decision as the open question. Six rounds of audits kept re-deriving this
  behaviour because the module's own comment asserted immunity.

## Fixed (lane B)

- **F1 (Medium-low)**: round 30 taught noticeFromError to keep the machine
  stamp — but the five hand-composed reader notices (bulk archive, bulk
  delete, bulk-failure summary, failed session start, workspace removal)
  compose their own noticeForReader and dropped the stamp again. They now
  carry it, so deleteMachine retires them.
- **F2 (Medium-low)**: recreateCachedNewSession awaited a start with no
  machine guard after it — a late answer prepended machine A's session into
  machine B's list, moved the draft under B's key, and yanked the selection.
  The continuation returns when the reader has switched.
- **F4 (Low, doc)**: the round-17 page's "not by matching the wording"
  decision never gained round 22's erratum; recorded on the page.

## Deferred with written reason

- Lane B F3 (machineDownNotice composes a transport claim for an
  answer-shaped 5xx): the classification-side twin of the pending vouching
  vocabulary; recorded adjacent to it.
- Lane B F5 (machine-scoped reader banners name no machine in their text):
  the display-side half of the scope principle — compose-named is the
  owner's standing wording decision, so this is filed for the same call.
- Lane B F6 (hold bookkeeping restarts the 6s clock on scope switch,
  benign direction): only matters if the owner rules 6s a hard lifetime.
- Lane C F3 (the shell sizes contributed sections by custom-element tag,
  a vocabulary the plugin contract does not reserve): the fix is a
  host-side wrapper or a contract reservation — plugin-architecture goal
  territory, filed there.
- Lane C F4 (the collapse-toggle chain's session-list leg): the ledger item
  is confirmed and widened for the owner's restore-or-excise call.
- Lane A F1 (the .machine-row 12px radius is dead under the adopted-sheet
  order): the sixth live instance of the host-stylesheet-order owner item,
  now with the internal-lists asymmetry (built-ins win ties, plugins lose
  them) written out.
- Lane A F3/F4/F5 (pointerQueryOrder blind spots): latent, no live offence;
  ledger carried.

## Errata

- Lane A F2: the tiles comment said auto-fill while the rule says auto-fit;
  the comment is corrected to the shipped rule — whether single-card
  installations should get auto-fill's compact shape is a design question,
  not this round's call.
- The sheet-machines-slot changeset's "hides below two machines" predates
  the dd95229c relaxation to one; annotated on the changeset (lane C F5).
